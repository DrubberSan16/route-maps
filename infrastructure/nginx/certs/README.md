# Certificados TLS

Coloca aquí (o en la carpeta indicada por `TLS_CERTS_PATH`) los certificados del dominio
para producción:

- `fullchain.pem`: certificado + cadena intermedia.
- `privkey.pem`: clave privada.

Se montan en solo lectura en `/etc/nginx/certs` cuando se usa `docker-compose.prod.yml`
con `NGINX_SERVER_CONF=./infrastructure/nginx/tls/https.conf`. Los archivos `*.pem`
están en `.gitignore`: nunca se suben al repositorio.
