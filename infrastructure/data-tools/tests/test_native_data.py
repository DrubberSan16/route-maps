"""The download manifest: the audit record of every source layer the build reads."""

import argparse
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# The script is bin/native-data.py in the repository and /usr/local/bin/native-data in the image.
SCRIPTS = (Path(__file__).resolve().parent.parent / "bin" / "native-data.py", Path("/usr/local/bin/native-data"))


def load_script():
    script = next((path for path in SCRIPTS if path.exists()), None)
    if script is None:
        raise FileNotFoundError(f"native-data script not found in {', '.join(map(str, SCRIPTS))}")
    loader = importlib.machinery.SourceFileLoader("native_data", str(script))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader("native_data", loader))
    loader.exec_module(module)
    return module


native_data = load_script()


def layer(source_id, required=False):
    return {"id": source_id, "kind": "arcgis-feature-layer", "required": required}


class DownloadManifestTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        catalog = root / "sources.json"
        catalog.write_text(json.dumps({"regions": [{
            "code": "gye", "name": "Guayaquil", "bbox": [-80.1, -2.4, -79.7, -1.9],
            "layers": [layer("roads", required=True), layer("parks"), layer("schools")],
        }]}), encoding="utf-8")
        self.destination = root / "imports" / "gye"
        self.downloads = 0
        for name, value in (("CATALOG", catalog), ("IMPORTS", root / "imports"),
                            ("download_layer", self.fake_download)):
            patcher = mock.patch.object(native_data, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def fake_download(self, source, destination, bbox, force):
        self.downloads += 1
        destination.mkdir(parents=True, exist_ok=True)
        (destination / f"{source['id']}.geojson").write_text('{"type":"FeatureCollection","features":[]}')
        return {"id": source["id"], "status": "downloaded", "featureCount": 0, "sha256": f"run{self.downloads}"}

    def download(self, layers=None, include_optional=False):
        args = argparse.Namespace(region="gye", layer=layers, include_optional=include_optional,
                                  include_large=False, force=False)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            native_data.command_download(args)
        manifest = json.loads((self.destination / "manifest.json").read_text(encoding="utf-8"))
        return {entry["id"]: entry["sha256"] for entry in manifest["layers"]}

    def test_a_plain_run_keeps_the_records_of_optional_layers_still_cached(self):
        self.assertEqual(self.download(include_optional=True),
                         {"roads": "run1", "parks": "run2", "schools": "run3"})
        (self.destination / "schools.geojson").unlink()
        # Only the required layer is fetched; the build still reads the parks downloaded before.
        manifest = self.download()
        self.assertEqual(manifest, {"roads": "run4", "parks": "run2"})
        self.assertEqual(list(manifest), ["roads", "parks"])

    def test_a_targeted_refresh_keeps_the_other_layers_in_catalog_order(self):
        self.download(include_optional=True)
        manifest = self.download(layers=["parks"])
        self.assertEqual(manifest, {"roads": "run1", "parks": "run4", "schools": "run3"})
        self.assertEqual(list(manifest), ["roads", "parks", "schools"])


if __name__ == "__main__":
    unittest.main()
