# Alpha Test Checklist

A printable run-through for testing a new deployment with a real community. Work top to bottom; every box maps to something a normal operator or member would do. Note anywhere you hesitate or re-read — those are guide or product bugs.

## 1. Discord Layout

Create a "Rewards" channel category in the test server. No channel needs member typing: everything works through slash commands, buttons, and popups, and most bot replies are visible only to the member who ran the command.

- [ ] `#rewards-verify` — visible to *everyone including unverified members*; deny member messages; verification panel goes here.
- [ ] `#token-drop` — Holder role only; app commands allowed, member messages denied; daily `/points claim`.
- [ ] `#quests` — Holder role only; same permissions; proof submissions arrive via popup, never in the channel.
- [ ] `#raffles` — Holder role only; same permissions.
- [ ] `#shop` — Holder role only; same permissions (optional).
- [ ] `#sales-feed` — fully read-only for members; only the sales bot posts (optional, step 7).
- [ ] Create a holder role (e.g. "Holder") and move the bot's role above it.

## 2. Deploy Like A Stranger

Follow `docs/START_HERE.md` steps 1-11 exactly, without improvising.

- [ ] Discord application created and token copied.
- [ ] Private repository generated from the template.
- [ ] Cloudflare connected to only that repository; deploy succeeded.
- [ ] The app's launch check page loads and turns green on its own.
- [ ] Bot added to the server; bot role sits above the holder role.
- [ ] `/rules manage` opens the private manager in a browser.

Write down every step where you paused, re-read, or had to guess.

## 3. Prove The Loop Without NFTs (Demo Chain)

- [ ] In the manager, add a rule on **Demo Chain (testing)** for the Holder role (any valid-looking address, e.g. `0x0000000000000000000000000000000000000001`, minimum 1).
- [ ] `/verify panel` posted in `#verify-here`.
- [ ] You link a wallet through the panel; the Holder role appears; `#lounge` unlocks.
- [ ] `/verify status` shows the wallet and role; `/verify refresh` works.
- [ ] Unlink the wallet in the verification page, refresh — the role is removed and `#lounge` locks again.
- [ ] Remove the Demo Chain rule.

## 4. Real Holder Rule

- [ ] Add a real collection rule (NFT, token, or Solana collection) for the Holder role.
- [ ] A member who owns the asset verifies and gets the role.
- [ ] A member who does not own it verifies and does not get the role.
- [ ] Scheduled check: confirm nothing breaks after the next 15-minute pass (manager overview shows the last scheduled check).

## 5. Community Surfaces

- [ ] Branding: set community name, accent color, logo; the manager and verify page reflect them.
- [ ] Rewards: set currency name, daily reward, holder reward; upload a currency image.
- [ ] Members run `/points claim` (once per day, second attempt refuses), `/points balance`, `/points leaderboard`.
- [ ] A member tips another with `/tip`; daily tipping limit behaves as configured.
- [ ] Create one automatic quest (e.g. "Link a wallet") and one custom proof quest; members complete both; the custom one is approved from the manager's pending-proofs queue.
- [ ] Open a raffle, buy entries with points, draw a winner (try an automatic prize role), then cancel a second raffle and confirm refunds.
- [ ] Add a store item with a role and one without; buy both; the role arrives automatically and the other appears in Recent purchases.
- [ ] Create a nested rule variant (`(NFT A OR NFT B) AND Token C`) and confirm a member matching it gets the role.

## 6. Exports And Operations

- [ ] Manager overview shows verified members, wallets, rules, activity, and zero sync problems.
- [ ] Provider health check is green (retry button works).
- [ ] Download each CSV export (holders, balances, wallet links, audit) and confirm contents are sane and shortened addresses are the default.

## 7. Optional: Sales Bot (needs an indexer URL)

- [ ] Add an Alchemy NFT API URL for the network under Advanced network settings.
- [ ] Add a sales watch on a collection pointed at `#sales-feed`.
- [ ] On the next scheduled pass after a sale, an embed with image, price, and links appears.

## 8. Member Feedback

- [ ] Ask 2-3 members: "What confused you?" Write down exact words.
- [ ] Ask one nontechnical friend to deploy from scratch using only START_HERE.md. Watch silently; record every stall.
- [ ] File anything broken or confusing as a GitHub issue.
