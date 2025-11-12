# Concordium Indexer (SubQuery) for OnFinality

This repository contains a minimal SubQuery indexer for the Concordium blockchain that you can publish to IPFS and deploy on OnFinality. OnFinality requires only two things to start your deployment:
- The IPFS CID of your SubQuery project bundle
- The Concordium RPC endpoint (gRPC) to index from

Out of the box, this indexer:
- Indexes Account transfer transactions
- Indexes simple "Updated" transaction events
- Exposes the data via a GraphQL API (handled by SubQuery's query service)

You can extend the schema and mappings to capture additional data as required.

## Project structure

- project.yaml — SubQuery manifest (points to compiled mappings and defines handlers/filters)
- schema.graphql — GraphQL schema (entities stored and queryable)
- src/
  - index.ts — exports mapping handlers
  - mappings/concordium.ts — example Concordium handlers (transfer transactions and Updated events)
- package.json — scripts and dependencies
- tsconfig.json — TypeScript configuration

## Quick start (local build and IPFS publish)

Prerequisites:
- Node.js 18+ (LTS recommended)
- npm or yarn

Install dependencies:
- npm install

Generate types and build:
- npm run codegen
- npm run build
- npm run validate (optional)

Publish to IPFS to obtain a CID:
- npm run publish:ipfs

The publish command will output an IPFS CID similar to:
- ipfs://Qmabc...xyz

Copy that CID; you will use it in OnFinality.

## Deploy on OnFinality

1) Open https://indexing.onfinality.io and create a new deployment.
2) Choose SubQuery and select "From IPFS", then paste your IPFS CID from the publish step.
3) Select Indexer and Query versions (use latest unless you have a specific requirement).
4) Provide the Concordium RPC endpoint (gRPC):
   - Mainnet: grpc.mainnet.concordium.com:20000
   - Testnet: grpc.testnet.concordium.com:20000
   - Or your own/private Concordium node endpoint.

Notes:
- The project manifest (project.yaml) intentionally leaves `network.endpoint` empty; OnFinality will inject the endpoint you provide here.
- Optionally add a dictionary endpoint if available for your network to speed up indexing (not required).

Once the deployment is created, OnFinality will start indexing and expose a GraphQL API URL for queries.

## Customization

- Handlers:
  - `handleAccountTransfer` indexes account transfer transactions (filtered in project.yaml).
  - `handleUpdatedEvent` indexes simple Updated transaction events.
- Schema:
  - Edit `schema.graphql` to add or modify entities.
  - After changes, run `npm run codegen && npm run build` and republish to IPFS to get a new CID.
- Filters:
  - Adjust handler filters in `project.yaml` to target different transaction/event types.

## Troubleshooting

- Ensure you are using the Concordium-specific runner (`@subql/node-concordium`) as defined in project.yaml.
- If your chain uses different payload fields for transfers, update `src/mappings/concordium.ts` accordingly.
- Each code change requires republishing to IPFS to get a new CID, and updating your OnFinality deployment to that CID.

## License

MIT