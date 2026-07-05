# Configuration

The backend reads configuration from environment variables.

| Variable  | Type    | Default         | Description                                    |
| --------- | ------- | --------------- | ---------------------------------------------- |
| `PORT`    | integer | `8080`          | TCP port the HTTP server listens on            |
| `APP_ENV` | string  | `"development"` | Runtime environment (`development`, `production`) |

## Setting variables

### Linux / macOS

```bash
export PORT=3001
export APP_ENV=production
go run ./cmd/api
```

### Windows (PowerShell)

```powershell
$env:PORT = "3001"
$env:APP_ENV = "production"
go run ./cmd/api
```

### Docker

```bash
docker run -e PORT=3001 -e APP_ENV=production my-image
```
