# Seer Web UI

**Browser-based interface for viewing and managing eval sets**

## Quick Start

```bash
# Install dependencies
bun install

# Run development server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Features

- **Dashboard** - View all eval sets with stats
- **Eval Set Detail** - View/edit test cases, see run history
- **Results View** - Visualize evaluation results with scores
- **Create Eval Set** - Form-based creation
- **AI Generation** - Coming in Phase 2C

## Architecture

- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS
- **Database:** Shared SQLite with CLI (`../data/seer.db`)
- **ORM:** Drizzle (shared schema with CLI)

## Database Sharing

The web UI and CLI both access the same SQLite database:

```
lab/projects/seer/
├── data/
│   └── seer.db          # Shared database
├── src/                 # CLI code
│   └── db/schema.ts     # Schema definition
└── web/                 # Web UI code
    └── lib/db.ts        # Points to ../data/seer.db
```

This allows seamless switching between terminal and browser.

## Development

```bash
# Type check
bun run tsc --noEmit

# Build for production
bun run build

# Run production build
bun run start
```

---

**Built by Kenneth Cassel / Axon**
**Part of Seer Phase 2B**
