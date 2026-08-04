{{- define "cnpg-cluster.name" -}}
{{- required "name is required" .Values.name -}}
{{- end -}}

{{- define "cnpg-cluster.labels" -}}
app.kubernetes.io/name: {{ include "cnpg-cluster.name" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
