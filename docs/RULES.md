# Holder Role Rules

Holder Rewards can assign several Discord roles to one member. Every enabled rule is evaluated, and each Discord role is managed independently.

## Discord Setup

Commands synchronize automatically after deployment and upgrades. Move the bot's Discord role above every holder role it should manage. Discord requires the bot to have Manage Roles and only permits it to manage roles below its highest role.

Server managers use `/rules manage` to receive a private 30-minute link to the browser manager. The manager loads eligible Discord roles and supported networks into dropdowns, validates each rule with the existing ownership engine, and removes rules without exposing internal IDs.

The bot only shows roles below its highest Discord role. If no roles are available, move the bot role above the holder roles and open a new manager link.

The direct Discord commands remain available as an advanced alternative:

- `/rules add-nft chain:<id> contract:<address> minimum:<count> role:<role>`
- `/rules add-token chain:<id> contract:<address> minimum:<amount> role:<role>`
- `/rules add-trait chain:<id> contract:<address> trait:<name> value:<value> minimum:<count> role:<role>`
- `/rules add-nft-id chain:<id> contract:<address> token-id:<id> role:<role>`
- `/rules add-erc1155 chain:<id> contract:<address> token-id:<id> minimum:<units> role:<role>`
- `/rules add-solana mint:<address> minimum:<amount> role:<role>`
- `/rules mode role:<role> match:<Any|All>`
- `/rules list`
- `/rules remove rule-id:<id>`
- `/verify refresh` rechecks the invoking member immediately.

The chain value is the short ID from the setup page, such as `ethereum`, `base`, `polygon`, `arbitrum`, or `apechain`.

## Evaluation Behavior

- NFT rules currently support ERC-721 collection balances through `balanceOf`.
- Token rules support ERC-20 balances and read the token's decimals from its contract.
- Trait rules use the optional ERC-721 Enumerable and Metadata extensions to discover owned token IDs and read each token's `tokenURI`.
- Exact ERC-721 rules call `ownerOf(tokenId)` and therefore work even when a collection is not enumerable.
- ERC-1155 rules sum `balanceOf(wallet, tokenId)` across every linked EVM wallet.
- Solana rules sum every token account for an exact mint across all linked Solana wallets. Use a minimum of `1` for an exact NFT mint or a decimal amount for an SPL token.
- Collection-wide Solana rules count assets grouped under a verified collection across all linked Solana wallets. They require a DAS indexer URL configured under advanced network settings.
- When an EVM NFT indexer is configured for a chain, trait rules use it instead of the direct-RPC scan, which lifts the 15-NFT and enumerability limits below.
- Token IDs remain decimal strings throughout configuration and evaluation, preserving the complete `uint256` range without JavaScript number rounding.
- Trait names and values use exact, case-sensitive matching against common `attributes` or `traits` metadata arrays.
- IPFS, Arweave, inline JSON, and public HTTPS metadata are supported. Fetched traits are cached in D1 for 24 hours.
- Balances are summed across all linked wallets of the rule's chain family.
- Different rules may assign different roles, so one member can receive many holder roles.
- Each Discord role is a requirement group. **Any requirement** keeps or adds the role when at least one rule qualifies. **All requirements** requires every rule for that role to qualify.
- A group can combine EVM and Solana rules. Each rule is evaluated against wallets from its own chain family.
- A failed RPC request never causes role removal. The existing role is left unchanged until a successful recheck.
- In an All group, one confirmed false result makes the whole group false even if another provider failed. When every completed rule passes and one remains unavailable, the role is preserved until the missing result succeeds.
- Successful ownership results are cached for 60 seconds using a key bound to the chain configuration, complete rule, and sorted linked-wallet set. Provider errors are never cached.
- `/verify refresh` bypasses the ownership cache so a member can request an authoritative result after transferring an asset.
- Role additions and removals are written to `role_sync_events` for auditing.

A successful wallet link runs role synchronization automatically. Members can use `/verify refresh` after transferring assets or when a provider was temporarily unavailable.

## Current Limits

The free trait path scans at most 15 NFTs per member and only works when the collection implements `tokenOfOwnerByIndex` and `tokenURI`. Both are optional ERC-721 extensions. If a collection is non-enumerable, has more than 15 NFTs across a member's wallets, or returns inaccessible metadata, the check reports an error and leaves the existing role unchanged. JSON-RPC reads are batched to conserve provider and Cloudflare subrequests. See [ERC-721](https://eips.ethereum.org/EIPS/eip-721) and [OpenZeppelin ERC721Enumerable](https://docs.openzeppelin.com/contracts/5.x/api/token/erc721#ERC721Enumerable).

Nested groups such as `(NFT A OR NFT B) AND Token C` are not enabled yet. Trait checks for non-enumerable EVM collections and collection-wide Solana NFT rules work through the optional indexer configuration described in [chain support](CHAINS.md); without an indexer those checks report an error and leave existing roles unchanged. Exact EVM ownership follows [ERC-721 `ownerOf`](https://eips.ethereum.org/EIPS/eip-721), multi-token balances follow [ERC-1155 `balanceOf`](https://eips.ethereum.org/EIPS/eip-1155), and exact Solana mint balances use `getTokenAccountsByOwner`.

The Cloudflare deployment runs one rolling member recheck every 15 minutes. This conservative default stays compatible with the Workers Free limit of 50 external subrequests per invocation and rotates through about 96 enrolled members per day. Expired ownership-cache rows are removed by the scheduled job. Large communities on a Workers Paid plan can uncomment the `queues` block in `wrangler.jsonc` and create the `holder-role-sync` queue to offload rechecks to Cloudflare Queues. Members can always trigger a fresh, uncached check with `/verify refresh`. See [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
