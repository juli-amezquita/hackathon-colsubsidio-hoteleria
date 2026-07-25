# Entorno del MVP / demo del hackathon.
#
# Una instancia con Docker Compose. El escalado está escrito y probado en
# `escalado.tf`, pero NO se construye para el demo (D-25): se enciende cambiando
# una variable, no reescribiendo la arquitectura.

entorno = "mvp"
region  = "us-east-1"

tipo_instancia = "t4g.small" # Graviton: imágenes en linux/arm64
clase_rds      = "db.t4g.micro"
nodo_redis     = "cache.t4g.micro"

habilitar_escalado = false

# Vacío = solo SSM Session Manager, sin puerto 22 abierto.
# Es además lo que evita el problema de que el ISP rote la IP de quien administra.
ips_admin = []

retencion_audio_dias = 180
