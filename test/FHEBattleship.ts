import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

const W = 10;
const TOTAL = 17;

/**
 * Helper: commitment = keccak256(abi.encodePacked(xs,ys,salt))
 */
function commitmentOf(xs: number[], ys: number[], salt: string): string {
  // Pack the same way Solidity abi.encodePacked(xs,ys,salt) does:
  // - xs: uint8[17], ys: uint8[17], salt: bytes32
  const abi = ethers.AbiCoder.defaultAbiCoder();
  // abi.encodePacked isn't in ethers AbiCoder, so we emulate by solidityPacked:
  return ethers.keccak256(
    ethers.solidityPacked(["uint8[17]", "uint8[17]", "bytes32"], [xs, ys, salt]),
  );
}

async function deployFixture() {
  const factory = await ethers.getContractFactory("FHEBattleship");
  const c = await factory.deploy();
  await c.waitForDeployment();
  return { c, addr: await c.getAddress() };
}

describe("FHEBattleship", function () {
  let signers: Signers;

  before(async function () {
    const hs = await ethers.getSigners();
    signers = {
      deployer: hs[0],
      alice: hs[1],
      bob: hs[2],
    };
  });

  it("full flow: create -> place(encrypted once) -> shoot(public) -> decrypt hit -> reveal -> finalize", async function () {
    const { c, addr } = await deployFixture();

    // Create game (alice vs bob)
    const txCreate = await c.connect(signers.alice).createGame(await signers.bob.getAddress());
    await txCreate.wait();
    const gameId = 0;

    // Prepare boards (17 segments each).
    // For POC: just pick 17 deterministic unique cells.
    const aliceXs: number[] = [0, 1, 2, 3, 4, 0, 1, 2, 3, 0, 1, 2, 0, 1, 0, 9, 9];
    const aliceYs: number[] = [0, 0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 4, 6, 6, 8, 9, 8];

    const bobXs: number[] =   [5, 6, 7, 8, 9, 5, 6, 7, 8, 5, 6, 7, 5, 6, 5, 0, 0];
    const bobYs: number[] =   [0, 0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 4, 6, 6, 8, 9, 8];

    expect(aliceXs.length).to.eq(TOTAL);
    expect(bobXs.length).to.eq(TOTAL);

    // Commit salts
    const saltAlice = ethers.hexlify(ethers.randomBytes(32));
    const saltBob = ethers.hexlify(ethers.randomBytes(32));

    const commitAlice = commitmentOf(aliceXs, aliceYs, saltAlice);
    const commitBob = commitmentOf(bobXs, bobYs, saltBob);

    // Encrypt placement inputs: coords = [x0,y0,x1,y1,...]
    // IMPORTANT: we pack all values into ONE encryption call to share one inputProof.
    const encAliceInput = fhevm.createEncryptedInput(addr, await signers.alice.getAddress());
    for (let i = 0; i < TOTAL; i++) {
      encAliceInput.add8(aliceXs[i]).add8(aliceYs[i]);
    }
    const encAlice = await encAliceInput.encrypt();

    const encBobInput = fhevm.createEncryptedInput(addr, await signers.bob.getAddress());
    for (let i = 0; i < TOTAL; i++) {
      encBobInput.add8(bobXs[i]).add8(bobYs[i]);
    }
    const encBob = await encBobInput.encrypt();

    // Place ships (encrypted once)
    await (await c.connect(signers.alice).placeShips(gameId, encAlice.handles, encAlice.inputProof, commitAlice)).wait();
    await (await c.connect(signers.bob).placeShips(gameId, encBob.handles, encBob.inputProof, commitBob)).wait();

    // Now playing. Alice turn first.

    // Alice shoots a known bob segment (5,0) => HIT (encrypted)
    const hitCipher1 = await c.connect(signers.alice).shoot.staticCall(gameId, 5, 0);
    await (await c.connect(signers.alice).shoot(gameId, 5, 0)).wait();

    const clearHit1 = await fhevm.userDecryptEuint(
      FhevmType.euint8,
      hitCipher1,
      addr,
      signers.alice,
    );
    expect(clearHit1).to.eq(1);

    // Bob shoots a miss (4,9) (not in alice board)
    const hitCipher2 = await c.connect(signers.bob).shoot.staticCall(gameId, 4, 9);
    await (await c.connect(signers.bob).shoot(gameId, 4, 9)).wait();

    const clearHit2 = await fhevm.userDecryptEuint(FhevmType.euint8, hitCipher2, addr, signers.bob);
    expect(clearHit2).to.eq(0);

    // Reveal both boards
    await (await c.connect(signers.alice).revealBoard(gameId, aliceXs, aliceYs, saltAlice)).wait();
    await (await c.connect(signers.bob).revealBoard(gameId, bobXs, bobYs, saltBob)).wait();

    // Finalize
    await (await c.connect(signers.alice).finalize(gameId)).wait();

    const g = await c.games(gameId);
    expect(g.phase).to.eq(4); // Phase.Finished
    // winner might be 0 if nobody sunk all segments in this short test; that's OK
  });

  it("prevents repeat shot by the same shooter", async function () {
    const { c, addr } = await deployFixture();
    await (await c.connect(signers.alice).createGame(await signers.bob.getAddress())).wait();
    const gameId = 0;

    // minimal placement (still must be 17 coords). Reuse deterministic boards.
    const xs: number[] = [0, 1, 2, 3, 4, 0, 1, 2, 3, 0, 1, 2, 0, 1, 0, 9, 9];
    const ys: number[] = [0, 0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 4, 6, 6, 8, 9, 8];
    const xs2: number[] = [5, 6, 7, 8, 9, 5, 6, 7, 8, 5, 6, 7, 5, 6, 5, 0, 0];
    const ys2: number[] = [0, 0, 0, 0, 0, 2, 2, 2, 2, 4, 4, 4, 6, 6, 8, 9, 8];

    const salt1 = ethers.hexlify(ethers.randomBytes(32));
    const salt2 = ethers.hexlify(ethers.randomBytes(32));
    const c1 = commitmentOf(xs, ys, salt1);
    const c2 = commitmentOf(xs2, ys2, salt2);

    const enc1Input = fhevm.createEncryptedInput(addr, await signers.alice.getAddress());
    for (let i = 0; i < TOTAL; i++) enc1Input.add8(xs[i]).add8(ys[i]);
    const enc1 = await enc1Input.encrypt();

    const enc2Input = fhevm.createEncryptedInput(addr, await signers.bob.getAddress());
    for (let i = 0; i < TOTAL; i++) enc2Input.add8(xs2[i]).add8(ys2[i]);
    const enc2 = await enc2Input.encrypt();

    await (await c.connect(signers.alice).placeShips(gameId, enc1.handles, enc1.inputProof, c1)).wait();
    await (await c.connect(signers.bob).placeShips(gameId, enc2.handles, enc2.inputProof, c2)).wait();

    // Alice shoots (5,0)
    await (await c.connect(signers.alice).shoot(gameId, 5, 0)).wait();

    // Alice cannot shoot again immediately (turn alternates)
    await expect(c.connect(signers.alice).shoot(gameId, 6, 0)).to.be.revertedWith("not your turn");

    // Bob shoots something
    await (await c.connect(signers.bob).shoot(gameId, 4, 9)).wait();

    // Now Alice turn again, but repeat (5,0) should revert
    await expect(c.connect(signers.alice).shoot(gameId, 5, 0)).to.be.revertedWith("repeat shot");
  });
});
