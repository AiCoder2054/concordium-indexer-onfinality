# Concordium Indexer (SubQuery) for OnFinality

This repository contains a minimal SubQuery indexer for the Concordium blockchain that you can publish to IPFS and deploy on OnFinality. OnFinality requires only two things to start your deployment:
- The IPFS CID of your SubQuery project bundle
- The Concordium RPC endpoint (gRPC) to index from

Out of the box, this indexer:
- Indexes Account transfer transactions
- Indexes simple "Updated" transaction events
- Exposes the data via a GraphQL API (handled by SubQuery's query service)

You can extend the schema and mappings to capture additional data as required.

## Automated IPFS publishing (GitHub Actions)

You do not need to run anything locally. This repo includes a GitHub Actions workflow that builds the project and publishes it to IPFS automatically.

Setup (one-time):
1) In your GitHub repo, go to Settings → Secrets and variables → Actions.
2) Add a new repository secret named SUBQL_ACCESS_TOKEN with your SubQuery access token.
   - You can get this token from the OnFinality/SubQuery dashboard (profile → Refresh Token).

How it works:
- On every push to main (or master) and on manual dispatch, the workflow will:
  - Install dependencies
  - Run codegen, build, and validate
  - Publish the project to IPFS via SubQuery CLI
  - Extract and display the IPFS CID in the workflow Summary
  - Upload ipfs_cid.txt and publish_output.log as build artifacts

Where to find your IPFS CID:
- After the workflow completes, open the run and check the "Summary" tab for:
  - SubQuery IPFS CID: <CID>
  - IPFS Gateway URL: https://ipfs.io/ipfs/<CID>
- You can also download the artifact named subquery-ipfs-cid, which contains ipfs_cid.txt.

Manual run:
- Navigate to Actions → "Publish SubQuery to IPFS" → Run workflow.

## Project structure

- project.yaml — SubQuery manifest (points to compiled mappings and defines handlers/filters)
- schema.graphql — GraphQL schema (entities stored and queryable)
- src/
  - index.ts — exports mapping handlers
  - mappings/concordium.ts — example Concordium handlers (transfer transactions and Updated events)
- package.json — scripts and dependencies
- tsconfig.json — TypeScript configuration

## Deploy on OnFinality

1) Open https://indexing.onfinality.io and create a new deployment.
2) Choose SubQuery and select "From IPFS", then paste the IPFS CID from the workflow run summary.
3) Select Indexer and Query versions (use latest unless you have a specific requirement).
4) Provide the Concordium RPC endpoint (gRPC):
   - Mainnet: https://grpc.mainnet.concordium.com:20000
   - Testnet: https://grpc.testnet.concordium.com:20000
   - Or your own/private Concordium node endpoint (include https://).

Notes:
- OnFinality injects the Concordium endpoint; ensure the value includes the `https://` prefix or SubQuery will downgrade to insecure gRPC and the connection will be rejected.
- Optionally add a dictionary endpoint if available for your network to speed up indexing (not required).

Once the deployment is created, OnFinality will start indexing and expose a GraphQL API URL for queries.

## Customization

- Handlers:
  - `handleAccountTransfer` indexes account transfer transactions (filtered in project.yaml).
  - `handleUpdatedEvent` indexes simple Updated transaction events.
- Schema:
  - Edit `schema.graphql` to add or modify entities.
  - After changes, commit to main; the workflow will publish a new IPFS CID automatically. Use the new CID on OnFinality.
- Filters:
  - Adjust handler filters in `project.yaml` to target different transaction/event types.

## Troubleshooting

- The IPFS publish step requires SUBQL_ACCESS_TOKEN to be set as a repo secret.
- Ensure you are using the Concordium-specific runner (`@subql/node-concordium`) as defined in project.yaml.
- If your chain uses different payload fields for transfers, update `src/mappings/concordium.ts` accordingly.

## License

MIT