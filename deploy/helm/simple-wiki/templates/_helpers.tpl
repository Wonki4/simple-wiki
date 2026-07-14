{{- define "simple-wiki.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "simple-wiki.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "simple-wiki.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "simple-wiki.labels" -}}
helm.sh/chart: {{ include "simple-wiki.chart" . }}
app.kubernetes.io/name: {{ include "simple-wiki.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end -}}

{{- define "simple-wiki.selectorLabels" -}}
app.kubernetes.io/name: {{ include "simple-wiki.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "simple-wiki.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "simple-wiki.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "simple-wiki.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- include "simple-wiki.fullname" . -}}
{{- end -}}
{{- end -}}

{{- define "simple-wiki.appServiceName" -}}
{{- printf "%s-app" (include "simple-wiki.fullname" .) -}}
{{- end -}}

{{- define "simple-wiki.mcpName" -}}
{{- printf "%s-mcp" (include "simple-wiki.fullname" .) -}}
{{- end -}}

{{- define "simple-wiki.mcpWikiBaseUrl" -}}
{{- if .Values.mcp.wikiBaseUrl -}}
{{- .Values.mcp.wikiBaseUrl -}}
{{- else -}}
{{- printf "http://%s:%v" (include "simple-wiki.appServiceName" .) .Values.service.port -}}
{{- end -}}
{{- end -}}

{{/* 앱 컨테이너 환경변수(deployment와 migrate Job이 공유) */}}
{{- define "simple-wiki.appEnv" -}}
- name: HOSTNAME
  value: "0.0.0.0"
- name: PORT
  value: "3000"
- name: NODE_ENV
  value: "production"
- name: AUTH_URL
  value: {{ .Values.config.authUrl | quote }}
- name: AUTH_KEYCLOAK_ID
  value: {{ .Values.config.keycloakId | quote }}
- name: AUTH_KEYCLOAK_ISSUER
  value: {{ .Values.config.keycloakIssuer | quote }}
{{- if .Values.config.keycloakCA }}
- name: NODE_EXTRA_CA_CERTS
  value: /etc/ssl/keycloak-ca/ca.pem
{{- end }}
- name: ATTACHMENTS_DIR
  value: {{ .Values.config.attachmentsDir | quote }}
- name: AUTH_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "simple-wiki.secretName" . }}
      key: {{ .Values.secrets.keys.authSecret }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "simple-wiki.secretName" . }}
      key: {{ .Values.secrets.keys.databaseUrl }}
- name: AUTH_KEYCLOAK_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "simple-wiki.secretName" . }}
      key: {{ .Values.secrets.keys.keycloakSecret }}
{{- end -}}
