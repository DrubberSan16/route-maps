import 'fold_table.dart';

/// The search key of the backend (native-search.ts `fold`): lower case, canonical decomposition,
/// no combining accents (U+0300 to U+036F), and only ASCII letters and digits separated by one
/// space. "Malecón Simón-Bolívar" is "malecon simon bolivar".
///
/// Dart has no Unicode normalization: the characters that fold to a letter come from
/// [foldPairs], generated from the backend's own fold; any other character separates words.
String fold(String? text) {
  if (text == null || text.isEmpty) return '';
  final table = _table;
  final out = StringBuffer();
  var pendingSpace = false;
  for (var index = 0; index < text.length; index += 1) {
    final unit = text.codeUnitAt(index);
    int? letter;
    if ((unit >= 0x61 && unit <= 0x7a) || (unit >= 0x30 && unit <= 0x39)) {
      letter = unit;
    } else if (unit >= 0x41 && unit <= 0x5a) {
      letter = unit + 0x20;
    } else if (unit >= 0x300 && unit <= 0x36f) {
      // Combining accents disappear without separating the letters around them.
      continue;
    } else if (unit >= 0x80) {
      letter = table[unit];
    }
    if (letter == null) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && out.isNotEmpty) out.writeCharCode(0x20);
    pendingSpace = false;
    out.writeCharCode(letter);
  }
  return out.toString();
}

final Map<int, int> _table = () {
  final table = <int, int>{};
  for (var index = 0; index + 1 < foldPairs.length; index += 2) {
    table[foldPairs.codeUnitAt(index)] = foldPairs.codeUnitAt(index + 1);
  }
  return table;
}();
