# --------------------------------------------------------------------------
# CloudFront delante de la instancia
#
# Resuelve dos cosas y ninguna es rendimiento:
#
#   1. TLS. El Principio V exige que todo dato de inventario viaje cifrado, y
#      una aplicación con Service Worker necesita contexto seguro. CloudFront da
#      un certificado válido en *.cloudfront.net sin comprar dominio.
#   2. Puerto 443. Muchas redes corporativas —incluida la del equipo— filtran
#      puertos no estándar. El origen es el 80 de nginx, pero nadie lo ve.
#
# ## Un solo origen
#
# Antes eran dos: la instancia para la API y un bucket de S3 para las pantallas,
# con una lista de rutas aquí decidiendo cuál atendía cada petición. Ese reparto
# vive ahora en nginx, dentro de la instancia (`infra/nginx.conf`).
#
# El motivo es que la lista estaba en el sitio equivocado. Un cambio de rutas
# obligaba a un `terraform apply` y a esperar a que la distribución se propagara
# —quince minutos— para algo que no es infraestructura sino enrutado de la
# aplicación. Peor: durante esa espera, la ruta nueva devolvía el HTML de las
# pantallas con **código 200**. Ahora el reparto viaja en la misma imagen que el
# código que lo cumple y cambia en el mismo despliegue.
#
# La caché va DESACTIVADA por defecto a propósito: esto es un inventario, y
# servir una respuesta guardada sería servir un conteo viejo. Lo único que se
# cachea es `/_next/static`, que lleva hash en el nombre.
# --------------------------------------------------------------------------

data "aws_cloudfront_cache_policy" "sin_cache" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "todo_menos_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_cache_policy" "optimizado" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "api" {
  count = var.habilitar_escalado ? 0 : 1

  enabled         = true
  comment         = "${local.nombre} API"
  http_version    = "http2and3"
  price_class     = "PriceClass_100" # Norteamérica y Europa: suficiente para Colombia
  is_ipv6_enabled = true

  origin {
    origin_id   = "instancia"
    domain_name = aws_eip.backend[0].public_dns

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # el tramo CloudFront→origen va dentro de AWS
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  # Sin caché y sin métodos recortados: aquí pasa TODO, y quien decide es nginx.
  #
  # `allowed_methods` incluye los de escritura porque el mismo comportamiento
  # atiende `POST /rondas` y `GET /`. Dejar fuera POST daría un 403 de CloudFront
  # —no del backend— sobre cada conteo.
  default_cache_behavior {
    target_origin_id       = "instancia"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.sin_cache.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.todo_menos_host.id

    compress = true
  }

  # La sesión de voz. CloudFront reenvía WebSockets, pero solo si el
  # comportamiento no cachea y deja pasar todas las cabeceras — `Upgrade` y
  # `Connection` incluidas, que es lo que hace la política "todo menos Host".
  ordered_cache_behavior {
    path_pattern           = "/voz/sesion"
    target_origin_id       = "instancia"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.sin_cache.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.todo_menos_host.id

    # Sin compresión: comprimir un flujo de audio binario cuadro a cuadro solo
    # añade latencia a algo que ya viene comprimido por el códec.
    compress = false
  }

  # Lo único que se cachea: los estáticos de Next, que llevan hash en el nombre
  # y por tanto son inmutables. Es lo que hace que la pantalla abra rápido con
  # señal mala, y es también lo que descarga a la instancia — una t4g pequeña no
  # debería estar sirviendo el mismo JavaScript cien veces.
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "instancia"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD", "OPTIONS"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id = data.aws_cloudfront_cache_policy.optimizado.id
    compress        = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = { Name = "${local.nombre}-api" }
}
