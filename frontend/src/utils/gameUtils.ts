import { getFheInstance, initializeFheInstance } from './fhevm';
import { BrowserProvider, Contract, getAddress } from 'ethers';
import FHEGridGame from '../deployments/FHEGridGame.json';

const CONTRACT_ADDRESS = FHEGridGame.address;
const ABI = FHEGridGame.abi;

export interface GameCell {
    x: number;
    y: number;
    terrainType: number | null; // null = unknown (fog of war)
    hasTrap: boolean | null;
    hasLoot: boolean | null;
    // Store encrypted handles for lazy decryption
    _encTerrain?: bigint;
    _encTrap?: bigint;
    _encLoot?: bigint;
}

export interface UnitData {
    id: number;
    x: number | null;
    y: number | null;
    hp: number | null;
    atk: number | null;
    def: number | null;
    alive: boolean | null;
    owner: string;
    isOwned: boolean;
    // Store encrypted handles for lazy decryption
    _encX?: bigint;
    _encY?: bigint;
    _encHp?: bigint;
    _encAtk?: bigint;
    _encDef?: bigint;
    _encAlive?: bigint;
}

export interface GameState {
    currentUnitTurn: number;
    currentRound: number;
    units: UnitData[];
    grid: GameCell[][];
    myUnits: number[]; // unit IDs owned by current player
}

/**
 * Create encrypted input for game actions
 */
export const createGameEncryptedInput = async (
    contractAddress: string,
    userAddress: string,
    value: number
) => {
    const instance = await initializeFheInstance();
    const inputHandle = instance.createEncryptedInput(contractAddress, userAddress);
    inputHandle.add8(value);
    return await inputHandle.encrypt();
};

/**
 * Decrypt euint8 value
 */
export const decryptEuint8 = async (
    handle: bigint,
    contractAddress: string,
    userAddress: string
): Promise<number | null> => {
    try {
        const instance = await initializeFheInstance();
        const checksummedContractAddress = getAddress(contractAddress);
        const checksummedUserAddress = getAddress(userAddress);

        const keypair = instance.generateKeypair();
        const handleStr = handle.toString();

        const handleContractPairs = [
            {
                handle: handleStr,
                contractAddress: checksummedContractAddress,
            },
        ];

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
        return decrypted !== undefined ? Number(decrypted) : null;
    } catch (error: any) {
        console.error("Decryption error:", error);
        return null;
    }
};

/**
 * Decrypt ebool value
 */
export const decryptEbool = async (
    handle: bigint,
    contractAddress: string,
    userAddress: string
): Promise<boolean | null> => {
    try {
        const value = await decryptEuint8(handle, contractAddress, userAddress);
        return value !== null ? value !== 0 : null;
    } catch (error) {
        console.error("Decryption error:", error);
        return null;
    }
};

/**
 * Decrypt euint16 value
 */
export const decryptEuint16 = async (
    handle: bigint,
    contractAddress: string,
    userAddress: string
): Promise<number | null> => {
    // For POC, euint16 decrypt similar to euint8
    return await decryptEuint8(handle, contractAddress, userAddress);
};


/**
 * Get game state from contract (without decrypting - fast load)
 */
export const getGameState = async (
    account: string,
    provider: BrowserProvider
): Promise<GameState | null> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);

        // Get turn info
        const [currentUnitTurn, currentRound] = await contract.getCurrentTurn();

        // Get unit count
        const unitCount = await contract.getUnitCount();

        // Get all units (without decrypting)
        const units: UnitData[] = [];
        const myUnits: number[] = [];

        for (let i = 0; i < Number(unitCount); i++) {
            const owner = await contract.getUnitOwner(i);
            const isOwned = owner.toLowerCase() === account.toLowerCase();

            if (isOwned) {
                myUnits.push(i);
                
                // Fetch encrypted data but don't decrypt yet
                try {
                    const [encX, encY] = await contract.getUnitPosition(i);
                    const [encHp, encAtk, encDef, encAlive] = await contract.getUnitStats(i);
                    
                    units.push({
                        id: i,
                        x: null,
                        y: null,
                        hp: null,
                        atk: null,
                        def: null,
                        alive: null,
                        owner,
                        isOwned: true,
                        _encX: encX,
                        _encY: encY,
                        _encHp: encHp,
                        _encAtk: encAtk,
                        _encDef: encDef,
                        _encAlive: encAlive,
                    });
                } catch (error) {
                    console.error(`Error fetching unit ${i}:`, error);
                    units.push({
                        id: i,
                        x: null,
                        y: null,
                        hp: null,
                        atk: null,
                        def: null,
                        alive: null,
                        owner,
                        isOwned: true,
                    });
                }
            } else {
                units.push({
                    id: i,
                    x: null,
                    y: null,
                    hp: null,
                    atk: null,
                    def: null,
                    alive: null,
                    owner,
                    isOwned: false,
                });
            }
        }

        // Initialize empty grid - don't fetch cells until needed
        // This avoids loading 64 cells (192 encrypted handles) unnecessarily
        const grid: GameCell[][] = [];
        for (let y = 0; y < 8; y++) {
            const row: GameCell[] = [];
            for (let x = 0; x < 8; x++) {
                row.push({
                    x,
                    y,
                    terrainType: null,
                    hasTrap: null,
                    hasLoot: null,
                });
            }
            grid.push(row);
        }

        return {
            currentUnitTurn: Number(currentUnitTurn),
            currentRound: Number(currentRound),
            units,
            grid,
            myUnits,
        };
    } catch (error) {
        console.error("Error getting game state:", error);
        return null;
    }
};

/**
 * Decrypt unit data on-demand (triggers signature request)
 */
export const decryptUnitData = async (
    unit: UnitData,
    account: string
): Promise<UnitData> => {
    if (!unit.isOwned || !unit._encX) {
        return unit; // Already decrypted or not owned
    }

    try {
        const decrypted: Partial<UnitData> = {};
        
        if (unit._encX) decrypted.x = await decryptEuint8(unit._encX, CONTRACT_ADDRESS, account);
        if (unit._encY) decrypted.y = await decryptEuint8(unit._encY, CONTRACT_ADDRESS, account);
        if (unit._encHp) decrypted.hp = await decryptEuint16(unit._encHp, CONTRACT_ADDRESS, account);
        if (unit._encAtk) decrypted.atk = await decryptEuint16(unit._encAtk, CONTRACT_ADDRESS, account);
        if (unit._encDef) decrypted.def = await decryptEuint16(unit._encDef, CONTRACT_ADDRESS, account);
        if (unit._encAlive) decrypted.alive = await decryptEbool(unit._encAlive, CONTRACT_ADDRESS, account);

        return { ...unit, ...decrypted };
    } catch (error) {
        console.error("Error decrypting unit data:", error);
        return unit;
    }
};

/**
 * Batch decrypt multiple cells at once (optimized - fewer signature requests)
 * This reduces the number of signature requests by batching decrypts
 */
export const batchDecryptCells = async (
    cells: {x: number, y: number}[],
    account: string,
    provider: BrowserProvider
): Promise<Map<string, GameCell>> => {
    const result = new Map<string, GameCell>();
    
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
        const instance = await initializeFheInstance();
        const checksummedContractAddress = getAddress(CONTRACT_ADDRESS);
        const checksummedUserAddress = getAddress(account);

        // Collect all encrypted handles for batch decrypt
        const handleContractPairs: Array<{handle: string, contractAddress: string, x: number, y: number, type: 'terrain' | 'trap' | 'loot'}> = [];
        
        // Fetch all cell data first
        for (const cell of cells) {
            try {
                const [encTerrain, encTrap, encLoot] = await contract.getCell(cell.x, cell.y);
                handleContractPairs.push(
                    {handle: encTerrain.toString(), contractAddress: checksummedContractAddress, x: cell.x, y: cell.y, type: 'terrain'},
                    {handle: encTrap.toString(), contractAddress: checksummedContractAddress, x: cell.x, y: cell.y, type: 'trap'},
                    {handle: encLoot.toString(), contractAddress: checksummedContractAddress, x: cell.x, y: cell.y, type: 'loot'}
                );
            } catch (error) {
                // Cell fetch failed
                result.set(`${cell.x},${cell.y}`, {
                    x: cell.x,
                    y: cell.y,
                    terrainType: null,
                    hasTrap: null,
                    hasLoot: null,
                });
            }
        }

        if (handleContractPairs.length === 0) return result;

        // Single signature request for all decrypts
        const keypair = instance.generateKeypair();
        const startTimeStamp = Math.floor(Date.now() / 1000).toString();
        const durationDays = "10";
        const contractAddresses = [checksummedContractAddress];

        const eip712 = instance.createEIP712(
            keypair.publicKey,
            contractAddresses,
            startTimeStamp,
            durationDays
        );

        const signer = await provider.getSigner();
        const signature = await signer.signTypedData(
            eip712.domain,
            { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
            eip712.message
        );

        // Prepare handle pairs for batch decrypt
        const decryptPairs = handleContractPairs.map(p => ({
            handle: p.handle,
            contractAddress: p.contractAddress,
        }));

        // Batch decrypt all handles at once
        const decryptResults = await instance.userDecrypt(
            decryptPairs,
            keypair.privateKey,
            keypair.publicKey,
            signature.replace("0x", ""),
            contractAddresses,
            checksummedUserAddress,
            startTimeStamp,
            durationDays
        );

        // Process results and group by cell
        const cellData = new Map<string, {terrain?: number, trap?: boolean, loot?: boolean}>();
        
        for (const pair of handleContractPairs) {
            const key = `${pair.x},${pair.y}`;
            const value = decryptResults[pair.handle];
            
            if (!cellData.has(key)) {
                cellData.set(key, {});
            }
            
            const data = cellData.get(key)!;
            if (pair.type === 'terrain') {
                data.terrain = value !== undefined ? Number(value) : null;
            } else if (pair.type === 'trap') {
                data.trap = value !== undefined ? Number(value) !== 0 : null;
            } else if (pair.type === 'loot') {
                data.loot = value !== undefined ? Number(value) !== 0 : null;
            }
        }

        // Build result cells
        for (const cell of cells) {
            const key = `${cell.x},${cell.y}`;
            const data = cellData.get(key);
            
            if (data) {
                const terrainType = data.terrain ?? null;
                const hasTrap = data.trap ?? null;
                const hasLoot = data.loot ?? null;
                
                const finalTerrain = (terrainType === 0 && !hasTrap && !hasLoot) ? null : terrainType;
                
                result.set(key, {
                    x: cell.x,
                    y: cell.y,
                    terrainType: finalTerrain,
                    hasTrap,
                    hasLoot,
                });
            } else {
                result.set(key, {
                    x: cell.x,
                    y: cell.y,
                    terrainType: null,
                    hasTrap: null,
                    hasLoot: null,
                });
            }
        }
    } catch (error) {
        console.error("Batch decrypt error:", error);
        // Return empty cells on error
        for (const cell of cells) {
            result.set(`${cell.x},${cell.y}`, {
                x: cell.x,
                y: cell.y,
                terrainType: null,
                hasTrap: null,
                hasLoot: null,
            });
        }
    }
    
    return result;
};

/**
 * Fetch and decrypt single cell (legacy - use batchDecryptCells for multiple)
 */
export const fetchAndDecryptCell = async (
    x: number,
    y: number,
    account: string,
    provider: BrowserProvider
): Promise<GameCell> => {
    const result = await batchDecryptCells([{x, y}], account, provider);
    return result.get(`${x},${y}`) || {
        x,
        y,
        terrainType: null,
        hasTrap: null,
        hasLoot: null,
    };
};

/**
 * Move unit to new position
 */
export const moveUnit = async (
    unitId: number,
    newX: number,
    newY: number,
    account: string,
    signer: any
): Promise<boolean> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);

        // Create encrypted inputs
        const encX = await createGameEncryptedInput(CONTRACT_ADDRESS, account, newX);
        const encY = await createGameEncryptedInput(CONTRACT_ADDRESS, account, newY);

        // Call moveUnit
        const tx = await contract.moveUnit(
            unitId,
            encX.handles[0],
            encX.inputProof,
            encY.handles[0],
            encY.inputProof
        );

        await tx.wait();
        return true;
    } catch (error: any) {
        console.error("Move unit error:", error);
        throw error;
    }
};

/**
 * Create a new unit
 */
export const createUnit = async (
    x: number,
    y: number,
    hp: number,
    atk: number,
    def: number,
    account: string,
    signer: any
): Promise<boolean> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);

        // Create encrypted inputs
        const encX = await createGameEncryptedInput(CONTRACT_ADDRESS, account, x);
        const encY = await createGameEncryptedInput(CONTRACT_ADDRESS, account, y);
        const encHp = await createGameEncryptedInput(CONTRACT_ADDRESS, account, hp);
        const encAtk = await createGameEncryptedInput(CONTRACT_ADDRESS, account, atk);
        const encDef = await createGameEncryptedInput(CONTRACT_ADDRESS, account, def);

        // Call createUnit
        const tx = await contract.createUnit(
            encX.handles[0], encX.inputProof,
            encY.handles[0], encY.inputProof,
            encHp.handles[0], encHp.inputProof,
            encAtk.handles[0], encAtk.inputProof,
            encDef.handles[0], encDef.inputProof
        );

        await tx.wait();
        return true;
    } catch (error: any) {
        console.error("Create unit error:", error);
        throw error;
    }
};

/**
 * Register player
 */
export const registerPlayer = async (signer: any): Promise<boolean> => {
    try {
        const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
        const tx = await contract.registerPlayer();
        await tx.wait();
        return true;
    } catch (error: any) {
        console.error("Register player error:", error);
        throw error;
    }
};
