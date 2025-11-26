# FHE Battleship (Zama FHEVM) — private board, public shots

This repo contains a POC Battleship smart contract + Hardhat tests:

- Players encrypt their ship coordinates **once** at placement.
- Each turn, players shoot with clear `(x,y)`.
- The contract returns an encrypted `hit01` (`euint8` = 0/1). Only the shooter can decrypt it via ACL.

## Files

- `contracts/FHEBattleship.sol`
- `test/FHEBattleship.ts`

## Notes / Assumptions

- Board is 10x10, total ship cells = 17.
- Ships shapes are NOT validated in this POC (you can add a clear reveal-time validation if needed).
- Placement values are clamped into bounds. For clean reveal, just always provide in-range coords.

## Running

You need a Hardhat project configured for Zama FHEVM:

- `@fhevm/solidity`
- `@fhevm/hardhat-plugin`
- `@nomicfoundation/hardhat-ethers`

Then put:

- `FHEBattleship.sol` into `contracts/`
- `FHEBattleship.ts` into `test/`

Run:

```bash
npx hardhat test
```

## Extending

- Add deposits + reveal deadline + slashing if a player doesn't reveal.
- Validate ship shapes at reveal time (clear) against standard Battleship rules.
- Replace alternating turns with "hit grants extra turn" by using encrypted hit result only for UX,
  and using clear reveal-time logic to settle disputes.
