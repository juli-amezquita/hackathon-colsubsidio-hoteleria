output "endpoint_api" {
  description = "Dónde responde la API. Es la URL que consume el frontend."
  value       = var.habilitar_escalado ? "https://${aws_lb.principal[0].dns_name}" : "https://${aws_cloudfront_distribution.api[0].domain_name}"
}

output "origen_directo" {
  description = "El origen sin CloudFront. Solo para diagnóstico; muchas redes filtran el puerto 3000."
  value       = var.habilitar_escalado ? null : "http://${aws_eip.backend[0].public_ip}:3000"
}

output "ip_backend" {
  description = "IP elástica de la instancia (solo MVP, sin ALB)."
  value       = var.habilitar_escalado ? null : aws_eip.backend[0].public_ip
}

output "id_instancia" {
  description = "ID para abrir sesión: aws ssm start-session --target <id>"
  value       = var.habilitar_escalado ? null : aws_instance.backend[0].id
}

output "repositorio_ecr" {
  description = "Destino de la imagen del backend (construir para linux/arm64)."
  value       = aws_ecr_repository.api.repository_url
}

output "bucket_evidencia" {
  description = "Bucket de evidencia de audio y exportaciones."
  value       = aws_s3_bucket.evidencia.bucket
}

output "endpoint_postgres" {
  description = "Endpoint de PostgreSQL. Solo alcanzable desde la VPC."
  value       = aws_db_instance.postgres.endpoint
}

output "endpoint_redis" {
  description = "Endpoint de Redis. Solo alcanzable desde la VPC."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "prefijo_parametros" {
  description = "Prefijo en SSM Parameter Store donde vive la configuración."
  value       = local.prefijo_ssm
}

output "parametros_por_cargar" {
  description = <<-DESC
    Credenciales que Terraform NO conoce y hay que cargar aparte, para que no
    queden en el estado. Ninguna es obligatoria: sin ellas el sistema arranca
    en modo simulado (Restricción 5).
  DESC
  value       = [for k, v in aws_ssm_parameter.proveedores : v.name]
}

output "region" {
  description = "Región donde vive todo. La usa scripts/desplegar.sh."
  value       = var.region
}
