# Local Docker development with Cloudflare Tunnel

This dev stack runs Next.js in development mode on port `3000` and can expose
it through the `dev-janjez-social` Cloudflare Tunnel. It is separate from the
production Docker Compose stack and does not change production DNS records.

## Prepare local settings

In PowerShell, copy the example and edit `.env.dev` with the dev Supabase
settings and the tunnel token:

```powershell
Copy-Item .env.dev.example .env.dev
```

Use sandbox/test payment credentials. `.env.dev` is ignored by Git.

## Configure the Cloudflare Tunnel

In Cloudflare Zero Trust, configure the `dev-janjez-social` tunnel with this
public hostname:

| Setting | Value |
| --- | --- |
| Subdomain | `dev` |
| Domain | `janjez.social` |
| Service type | `HTTP` |
| Service URL | `app:3000` |

Put that tunnel's token in `TUNNEL_TOKEN` in `.env.dev`. The Cloudflare
container shares the Compose network with the app, so use `app:3000`, not
`localhost:3000`. Only the tunnel hostname is added; existing Vercel records
are not changed.

## Run

Start the app and tunnel:

```powershell
docker compose --env-file .env.dev -f docker-compose.dev.yml --profile cloudflare up --build
```

Or start only the app:

```powershell
docker compose --env-file .env.dev -f docker-compose.dev.yml up --build
```

The app is available at `http://localhost:3000`; with the tunnel running, it
is also available at `https://dev.janjez.social`. Stop the stack with:

```powershell
docker compose -f docker-compose.dev.yml down
```

VS Code tasks provide the same start/stop commands. The dev container starts
the app service only; start the tunnel using the host task or the command above.
