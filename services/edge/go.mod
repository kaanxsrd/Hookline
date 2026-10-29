module github.com/kaanxsrd/hookline/services/edge

go 1.27.0

require (
	github.com/go-chi/chi/v5 v5.5.0
	github.com/kaanxsrd/hookline/packages/gocommon v0.0.0
	github.com/stretchr/testify v1.12.1
)

require (
	github.com/google/uuid v1.6.0 // indirect
	go.yaml.in/yaml/v3 v3.0.5 // indirect
)

replace github.com/kaanxsrd/hookline/packages/gocommon => ../../packages/gocommon
