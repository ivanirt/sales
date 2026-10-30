# sales

Funnel coach. In Dokploy, create an application from this repo and set the container port to **3000**.

Mount a volume at `/app/memory` so projects and notes survive a redeploy. Set these environment variables in Dokploy:

- `AI_API_KEY` — model key. It stays in the host environment, not in the image.
- `AI_BASE_URL` — optional. Defaults to `https://api.openai.com/v1`.
- `AI_MODEL` — optional. Defaults to `gpt-4o-mini`.

`docker-compose.yml` is the same setup if you deploy with Compose instead of the Dockerfile.
