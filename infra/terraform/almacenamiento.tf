resource "random_id" "sufijo" {
  byte_length = 4
}

# --------------------------------------------------------------------------
# Evidencia de audio y exportaciones
#
# Solo se sube el audio de los turnos EN DISPUTA (~10%): los que generaron
# alerta, los que terminaron auditables y los que se resolvieron escogiendo
# entre candidatos. El resto se descarta en el dispositivo al confirmar la
# sincronización.
#
# La voz es dato personal (Ley 1581). Guardar meses de audio de 350 operarios
# sería una superficie que no necesitamos, y el Principio V exige minimización.
# --------------------------------------------------------------------------
resource "aws_s3_bucket" "evidencia" {
  bucket = "${local.nombre}-evidencia-${random_id.sufijo.hex}"
  tags   = { Name = "${local.nombre}-evidencia" }
}

resource "aws_s3_bucket_public_access_block" "evidencia" {
  bucket = aws_s3_bucket.evidencia.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidencia" {
  bucket = aws_s3_bucket.evidencia.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "evidencia" {
  bucket = aws_s3_bucket.evidencia.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "evidencia" {
  bucket     = aws_s3_bucket.evidencia.id
  depends_on = [aws_s3_bucket_versioning.evidencia]

  # El audio expira. La retención del LIBRO es otra cosa: la fija la política
  # contable de Colsubsidio y sigue pendiente de confirmar con el negocio.
  rule {
    id     = "expirar-audio"
    status = "Enabled"

    filter {
      prefix = "audio/"
    }

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = var.retencion_audio_dias
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "limpiar-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "evidencia_solo_tls" {
  bucket = aws_s3_bucket.evidencia.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "NegarSinTLS"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.evidencia.arn,
        "${aws_s3_bucket.evidencia.arn}/*",
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })
}
