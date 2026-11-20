# Boundary Planet

A small Tesseros arcade game about boundaries. Requests fly at a little solar system of three planets; each player moves and spins their planet so the right side meets each request. Heavy work can be bounced to a teammate who has room.

Live at **access.tesseros.com/boundary-planet/**. Design notes are on the Boundary Planet page in Notion (Products & Offers).

This repo is private, like perspective-flip-gate.

## How Playing Together Works

1. Someone opens the game, types their name and clicks **Create Room**. They get a four-letter code and a link to share.
2. Up to two more people join with the code or link. Open seats are played by computer teammates (Fern, Juno, Ash).
3. The host clicks **Start Season**.

The host's browser runs the game and sends everyone a snapshot about 12 times a second. Everyone else sends only their own planet's position and spin. Each room is a Cloudflare Durable Object that passes messages along (`src/index.js`). If the host leaves, that season ends and the next person in the room becomes host. If anyone else leaves, a computer teammate takes over their planet.

**Play Solo** still works with no room at all.

## How Updates Work

1. Change `public/boundary-planet/index.html` (the game) or `src/index.js` (the Worker and rooms) in a pull request.
2. Merge it.
3. GitHub Actions deploys to Cloudflare automatically (see the Actions tab). Live in a minute or two.

## Secrets (Settings, Secrets and Variables, Actions)

| Name | What it is |
|---|---|
| CLOUDFLARE_API_TOKEN | Cloudflare token with the "Edit Cloudflare Workers" template, limited to this account and the tesseros.com zone. The same kind of token perspective-flip-gate uses |
| CLOUDFLARE_ACCOUNT_ID | From the Cloudflare dashboard (Workers and Pages overview, right side) |

## How It Shares access.tesseros.com With Perspective Flip

perspective-flip-gate's Worker answers `access.tesseros.com/*`. This Worker answers only `access.tesseros.com/boundary-planet*`. Cloudflare sends each request to the most specific matching route, so the two don't interfere. Removing this Worker's route takes only Boundary Planet offline.

## Running It Locally

```
npx wrangler@4 dev
```

Then open http://localhost:8787/boundary-planet/ in two browser windows to try a room.

## Limits Worth Knowing

- Rooms run on the Workers Free plan. Messages over the live connection count toward the free daily request allowance; a playtest uses a tiny share of it. Over the free limit, new requests fail until the daily reset rather than costing money.
- Anyone with the link can play. There is no license gate yet.
- Wide screens work best for rooms. Everyone sees the same fixed-size playfield, scaled to fit.
