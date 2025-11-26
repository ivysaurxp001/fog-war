import { getFheInstance, initializeFheInstance } from './fhevm';
import { BrowserProvider, Contract, getAddress, keccak256 } from 'ethers';
import FHEBattleship from '../deployments/FHEBattleship.json';

const CONTRACT_ADDRESS = FHEBattleship.address;
const ABI = FHEBattleship.abi;

export const TOTAL_SEGMENTS = 17; // Standard Battleship: 5 ships = 17 segments
export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 10;

export interface ShipPlacement {
    x: number;
    y: number;
}

export interface GameInfo {
    p1: string;
    p2: string;
    phase: number; // 0=Waiting, 1=Placing, 2=Playing, 3=Reveal, 4=Finished
    turn: string;
    shotCount: number;
    winner: string;
}

export interface Shot {
    shooter: string;
    x: number;
    y: number;
    hitCipher?: bigint; // Encrypted hit/miss handle
}

/**
 * Pack all ship coordinates into single encrypted input
 * This creates ONE proof for all 34 coordinates (17 segments * 2 coords)
 */
export const packShipCoordinates = async (
    contractAddress: string,
    userAddress: string,
    ships: ShipPlacement[] // Array of 17 {x, y} pairs
): Promise<{ handles: bigint[], inputProof: string }> => {
    if (ships.length !== TOTAL_SEGMENTS) {
        throw new Error(`Must provide exactly ${TOTAL_SEGMENTS} ship segments, got ${ships.length}`);
    }

    console.log("Packing coordinates:", ships);

    try {
        const instance = await initializeFheInstance();
        const inputHandle = instance.createEncryptedInput(contractAddress, userAddress);

        // Pack all coordinates: [x0, y0, x1, y1, ..., x16, y16]
        for (let i = 0; i < ships.length; i++) {
            const ship = ships[i];
            if (ship.x < 0 || ship.x >= BOARD_WIDTH || ship.y < 0 || ship.y >= BOARD_HEIGHT) {
                throw new Error(`Invalid coordinates at index ${i}: (${ship.x}, ${ship.y})`);
            }
            inputHandle.add8(ship.x);
            inputHandle.add8(ship.y);
        }

        console.log("Encrypting packed coordinates...");
        const result = await inputHandle.encrypt();
        console.log("Encryption result:", { handlesCount: result.handles.length, proofLength: result.inputProof.length });
        
        return result;
    } catch (error: any) {
        console.error("Pack coordinates error:", error);
        throw new Error(`Failed to pack coordinates: ${error.message || error.toString()}`);
    }
};

/**
 * Create commitment for ship placement
 * commitment = keccak256(abi.encodePacked(xs, ys, salt))
 * Must match Solidity: keccak256(abi.encodePacked(xs, ys, salt))
 */
export const createCommitment = (
    ships: ShipPlacement[],
    salt: string
): string => {
    // Convert ships to arrays
    const xs: number[] = ships.map(s => s.x);
    const ys: number[] = ships.map(s => s.y);
    
    // Convert salt string to bytes32 hex (64 hex chars)
    let saltBytes: string;
    if (salt.startsWith('0x')) {
        saltBytes = salt.slice(2).padStart(64, '0');
    } else {
        saltBytes = salt.padStart(64, '0');
    }
    
    // Pack: uint8[17] xs, uint8[17] ys, bytes32 salt
    // abi.encodePacked concatenates bytes without padding
    // For uint8, each value is 1 byte
    let packed = '0x';
    for (const x of xs) {
        packed += x.toString(16).padStart(2, '0');
    }
    for (const y of ys) {
        packed += y.toString(16).padStart(2, '0');
    }
    packed += saltBytes;
    
    // Use ethers keccak256 (matches Solidity keccak256)
    return keccak256(packed);
};

/**
 * Generate random salt for commitment
 */
export const generateSalt = (): string => {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    return Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Place ships on board
 */
export const placeShips = async (
    gameId: number,
    ships: ShipPlacement[],
    salt: string,
    account: string,
    signer: any
): Promise<boolean> => {
    try {
        console.log("Placing ships:", { gameId, shipsCount: ships.length, contractAddress: CONTRACT_ADDRESS });
        
        const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
        
        // Pack coordinates into single encrypted input
        console.log("Step 1: Packing coordinates...");
        const encrypted = await packShipCoordinates(CONTRACT_ADDRESS, account, ships);
        
        if (!encrypted.handles || encrypted.handles.length === 0) {
            throw new Error("Encryption failed: no handles returned");
        }
        
        if (!encrypted.inputProof) {
            throw new Error("Encryption failed: no proof returned");
        }
        
        console.log("Step 2: Creating commitment...");
        // Create commitment
        const commitment = createCommitment(ships, salt);
        console.log("Commitment:", commitment);
        
        // Call placeShips with packed coordinates
        console.log("Step 3: Calling contract.placeShips...");
        console.log("Parameters:", {
            gameId,
            handlesCount: encrypted.handles.length,
            proofLength: encrypted.inputProof.length,
            commitment
        });
        
        const tx = await contract.placeShips(
            gameId,
            encrypted.handles,
            encrypted.inputProof,
            commitment
        );
        
        console.log("Transaction sent, waiting for confirmation...");
        await tx.wait();
        console.log("Transaction confirmed!");
        
        return true;
    } catch (error: any) {
        console.error("Place ships error:", error);
        // Provide more detailed error message
        if (error.reason) {
            throw new Error(`Contract error: ${error.reason}`);
        }
        if (error.data) {
            throw new Error(`Transaction failed: ${error.data}`);
        }
        throw error;
    }
};

/**
 * Shoot at opponent's board
 * @param gameId Game ID
 * @param x Public x coordinate (0-9)
 * @param y Public y coordinate (0-9)
 * @returns Encrypted hit/miss handle (for decryption)
 */
export const shoot = async (
    gameId: number,
    x: number,
    y: number,
    signer: any
): Promise<bigint> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
        
        console.log("Shooting at:", { gameId, x, y });
        
        // Shoot with public coordinates (no encryption needed!)
        // Note: shoot() returns ebool, but we need to get it from the shot history
        const tx = await contract.shoot(gameId, x, y);
        console.log("Transaction sent, waiting for confirmation...");
        const receipt = await tx.wait();
        console.log("Transaction confirmed! Block:", receipt.blockNumber);
        
        // Wait a bit for state to update
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Get the latest shot to extract hitCipher
        const shotCount = await contract.getShotCount(gameId);
        console.log("Current shot count:", shotCount);
        
        if (shotCount === 0) {
            throw new Error("No shots found after shooting");
        }
        
        const shot = await contract.getShot(gameId, shotCount - 1);
        console.log("Latest shot:", { shooter: shot.shooter, x: shot.x, y: shot.y });
        
        if (!shot.hitCipher) {
            throw new Error("No hitCipher in shot result");
        }
        
        return shot.hitCipher;
    } catch (error: any) {
        console.error("Shoot error:", error);
        throw error;
    }
};

/**
 * Decrypt hit/miss result
 */
export const decryptHitMiss = async (
    hitCipher: bigint,
    account: string
): Promise<boolean> => {
    try {
        const instance = await initializeFheInstance();
        const checksummedContractAddress = getAddress(CONTRACT_ADDRESS);
        const checksummedUserAddress = getAddress(account);

        const keypair = instance.generateKeypair();
        const handleStr = hitCipher.toString();

        const handleContractPairs = [{
            handle: handleStr,
            contractAddress: checksummedContractAddress,
        }];

        const startTimeStamp = Math.floor(Date.now() / 1000).toString();
        const durationDays = "10";
        const contractAddresses = [checksummedContractAddress];

        const eip712 = instance.createEIP712(
            keypair.publicKey,
            contractAddresses,
            startTimeStamp,
            durationDays
        );

        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const signature = await signer.signTypedData(
            eip712.domain,
            { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
            eip712.message
        );

        const result = await instance.userDecrypt(
            handleContractPairs,
            keypair.privateKey,
            keypair.publicKey,
            signature.replace("0x", ""),
            contractAddresses,
            checksummedUserAddress,
            startTimeStamp,
            durationDays
        );

        const decrypted = result[handleStr];
        return decrypted !== undefined ? Number(decrypted) !== 0 : false;
    } catch (error: any) {
        console.error("Decrypt hit/miss error:", error);
        throw error;
    }
};

/**
 * Reveal board with clear coordinates
 */
export const revealBoard = async (
    gameId: number,
    ships: ShipPlacement[],
    salt: string,
    signer: any
): Promise<boolean> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
        
        // Convert ships to arrays
        const xs: number[] = ships.map(s => s.x);
        const ys: number[] = ships.map(s => s.y);
        
        // Convert salt string to bytes32 (64 hex chars)
        let saltBytes: string;
        if (salt.startsWith('0x')) {
            saltBytes = '0x' + salt.slice(2).padStart(64, '0');
        } else {
            saltBytes = '0x' + salt.padStart(64, '0');
        }
        
        const tx = await contract.revealBoard(
            gameId,
            xs,
            ys,
            saltBytes
        );
        
        await tx.wait();
        return true;
    } catch (error: any) {
        console.error("Reveal board error:", error);
        throw error;
    }
};

/**
 * Create a new game
 */
export const createGame = async (
    opponent: string,
    signer: any
): Promise<number> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
        const tx = await contract.createGame(opponent);
        const receipt = await tx.wait();
        
        // Extract gameId from event
        const event = receipt.logs.find((log: any) => {
            try {
                const parsed = contract.interface.parseLog(log);
                return parsed && parsed.name === 'GameCreated';
            } catch {
                return false;
            }
        });
        
        if (event) {
            const parsed = contract.interface.parseLog(event);
            return Number(parsed.args.gameId);
        }
        
        // Fallback: get nextGameId - 1
        const nextId = await contract.nextGameId();
        return Number(nextId) - 1;
    } catch (error: any) {
        console.error("Create game error:", error);
        throw error;
    }
};

/**
 * Get game info
 */
export const getGame = async (
    gameId: number,
    provider: BrowserProvider
): Promise<GameInfo> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
        const game = await contract.getGame(gameId);
        return {
            p1: game.p1,
            p2: game.p2,
            phase: Number(game.phase),
            turn: game.turn,
            shotCount: Number(game.shotCount),
            winner: game.winner,
        };
    } catch (error: any) {
        console.error("Get game error:", error);
        throw error;
    }
};

/**
 * Get all shots for a game
 */
export const getShots = async (
    gameId: number,
    provider: BrowserProvider
): Promise<Shot[]> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
        const shots = await contract.getShots(gameId);
        return shots.map((shot: any) => ({
            shooter: shot.shooter,
            x: Number(shot.x),
            y: Number(shot.y),
            hitCipher: shot.hitCipher,
        }));
    } catch (error: any) {
        console.error("Get shots error:", error);
        throw error;
    }
};

/**
 * Check if shot position has been used
 */
export const isShotUsed = async (
    gameId: number,
    player: string,
    x: number,
    y: number,
    provider: BrowserProvider
): Promise<boolean> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
        const idx = x + y * BOARD_WIDTH;
        return await contract.shotUsed(gameId, player, idx);
    } catch (error: any) {
        console.error("Check shot used error:", error);
        return false;
    }
};

/**
 * Get all games where player is p1 or p2
 */
export const getPlayerGames = async (
    player: string,
    provider: BrowserProvider
): Promise<number[]> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
        const gameIds = await contract.getPlayerGames(player);
        return gameIds.map((id: bigint) => Number(id));
    } catch (error: any) {
        console.error("Get player games error:", error);
        return [];
    }
};

/**
 * Get next game ID (for scanning all games)
 */
export const getNextGameId = async (
    provider: BrowserProvider
): Promise<number> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
        const nextId = await contract.getNextGameId();
        return Number(nextId);
    } catch (error: any) {
        console.error("Get next game ID error:", error);
        return 0;
    }
};

/**
 * Find games where player is p1 or p2 (by scanning)
 */
export const findPlayerGames = async (
    player: string,
    provider: BrowserProvider
): Promise<Array<{ gameId: number, game: GameInfo }>> => {
    try {
        const nextId = await getNextGameId(provider);
        const playerGames: Array<{ gameId: number, game: GameInfo }> = [];
        
        // Scan through games (limit to first 100 for performance)
        const maxScan = Math.min(nextId, 100);
        for (let i = 0; i < maxScan; i++) {
            try {
                const game = await getGame(i, provider);
                if (game.p1.toLowerCase() === player.toLowerCase() || 
                    game.p2.toLowerCase() === player.toLowerCase()) {
                    playerGames.push({ gameId: i, game });
                }
            } catch (error) {
                // Game doesn't exist or error, skip
                continue;
            }
        }
        
        return playerGames;
    } catch (error: any) {
        console.error("Find player games error:", error);
        return [];
    }
};

/**
 * Standard Battleship ship configurations
 * Returns array of 17 segments for standard 5 ships
 */
export const getStandardShips = (): ShipPlacement[] => {
    // Standard Battleship: Carrier(5), Battleship(4), Cruiser(3), Submarine(3), Destroyer(2) = 17 segments
    // Example placement (can be randomized)
    return [
        // Carrier (5 segments) - horizontal at (0,0)
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
        // Battleship (4 segments) - vertical at (6,0)
        { x: 6, y: 0 }, { x: 6, y: 1 }, { x: 6, y: 2 }, { x: 6, y: 3 },
        // Cruiser (3 segments) - horizontal at (0,2)
        { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
        // Submarine (3 segments) - vertical at (4,2)
        { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 },
        // Destroyer (2 segments) - horizontal at (8,8)
        { x: 8, y: 8 }, { x: 9, y: 8 },
    ];
};

