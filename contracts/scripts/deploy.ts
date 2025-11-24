import { ethers, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const signers = await ethers.getSigners();
    if (signers.length === 0) {
        console.error("❌ Error: No signers found!");
        console.error("Please check your .env file in the contracts directory.");
        console.error("Make sure PRIVATE_KEY is set and is at least 64 characters long.");

        // Debug info
        const key = process.env.PRIVATE_KEY;
        console.log("Debug: PRIVATE_KEY length is:", key ? key.length : "undefined");
        process.exit(1);
    }

    const deployer = signers[0];
    console.log("Deploying contracts with the account:", deployer.address);

    const counter = await ethers.deployContract("FHECounter");
    await counter.waitForDeployment();

    console.log(`FHECounter deployed to ${counter.target}`);

    // Save deployment info to frontend
    const deploymentDir = path.join(__dirname, "../../frontend/src/deployments");
    if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const artifact = await artifacts.readArtifact("FHECounter");

    const deploymentData = {
        address: counter.target,
        abi: artifact.abi
    };

    const deploymentFile = path.join(deploymentDir, "FHECounter.json");
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
    console.log(`Deployment data saved to ${deploymentFile}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
