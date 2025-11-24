import { useState, useEffect } from 'react'
import { BrowserProvider } from 'ethers'
import { useFhevm } from './components/FhevmProvider'
import { 
    GameState, 
    UnitData,
    getGameState, 
    moveUnit, 
    createUnit, 
    registerPlayer,
    decryptUnitData,
    batchDecryptCells
} from './utils/gameUtils'

function App() {
    const { isInitialized, account, connect, error } = useFhevm();
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [loading, setLoading] = useState(false);
    const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
    const [selectedCell, setSelectedCell] = useState<{x: number, y: number} | null>(null);
    const [message, setMessage] = useState<string>('');

    useEffect(() => {
        if (isInitialized && account) {
            refreshGameState();
        }
    }, [isInitialized, account]);

    const refreshGameState = async (decrypt = false) => {
        if (!window.ethereum || !account) return;
        try {
            setLoading(true);
            setMessage(decrypt ? "Loading and decrypting game state (signature required)..." : "Loading game state...");
            
            const provider = new BrowserProvider(window.ethereum);
            const state = await getGameState(account, provider);
            
            if (state) {
                // If decrypt is true, decrypt owned units first, then cells based on unit positions
                if (decrypt && account) {
                    // Step 1: Decrypt owned units to get their positions
                    setMessage("Decrypting unit data...");
                    for (let i = 0; i < state.units.length; i++) {
                        if (state.units[i].isOwned) {
                            state.units[i] = await decryptUnitData(state.units[i], account);
                        }
                    }
                    
                    // Step 2: Now that we know unit positions, fetch and decrypt visible cells
                    setMessage("Decrypting vision (1 signature request for all cells)...");
                    const cellsToDecrypt: {x: number, y: number}[] = [];
                    const decryptedCells = new Set<string>();
                    
                    for (const unitId of state.myUnits) {
                        const unit = state.units[unitId];
                        if (unit.x !== null && unit.y !== null) {
                            // Collect cells around unit (vision radius 2) - avoid duplicates
                            for (let y = Math.max(0, unit.y - 2); y <= Math.min(7, unit.y + 2); y++) {
                                for (let x = Math.max(0, unit.x - 2); x <= Math.min(7, unit.x + 2); x++) {
                                    const key = `${x},${y}`;
                                    if (!decryptedCells.has(key)) {
                                        cellsToDecrypt.push({x, y});
                                        decryptedCells.add(key);
                                    }
                                }
                            }
                        }
                    }
                    
                    // Batch decrypt all cells with ONE signature request
                    if (cellsToDecrypt.length > 0) {
                        const decryptedCellsMap = await batchDecryptCells(cellsToDecrypt, account, provider);
                        for (const [key, cell] of decryptedCellsMap.entries()) {
                            const [x, y] = key.split(',').map(Number);
                            state.grid[y][x] = cell;
                        }
                    }
                    
                    setMessage("Game state loaded successfully!");
                } else {
                    setMessage("Game state loaded (click 'Load & Decrypt Vision' to see encrypted data)");
                }
                
                setGameState(state);
            }
        } catch (error: any) {
            console.error("Error fetching game state:", error);
            setMessage("Error: " + (error.message || "Unknown error"));
        } finally {
            setLoading(false);
        }
    };

    const handleRegisterPlayer = async () => {
        if (!window.ethereum || !account) return;
        setLoading(true);
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            await registerPlayer(signer);
            setMessage("Successfully registered!");
            await refreshGameState();
        } catch (error: any) {
            console.error("Register error:", error);
            setMessage("Registration failed: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateUnit = async () => {
        if (!window.ethereum || !account || !selectedCell) return;
        setLoading(true);
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            await createUnit(
                selectedCell.x,
                selectedCell.y,
                50, // HP
                10, // ATK
                5,  // DEF
                account,
                signer
            );
            setMessage("Unit created!");
            await refreshGameState();
            setSelectedCell(null);
        } catch (error: any) {
            console.error("Create unit error:", error);
            setMessage("Failed to create unit: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleMoveUnit = async (unitId: number, newX: number, newY: number) => {
        if (!window.ethereum || !account) return;
        setLoading(true);
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            await moveUnit(unitId, newX, newY, account, signer);
            setMessage("Unit moved!");
            await refreshGameState();
            setSelectedUnitId(null);
            setSelectedCell(null);
        } catch (error: any) {
            console.error("Move error:", error);
            setMessage("Move failed: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCellClick = (x: number, y: number) => {
        if (!gameState) return;

        // If no units exist, allow cell selection for unit creation
        if (gameState.units.length === 0 || gameState.myUnits.length === 0) {
            setSelectedCell({ x, y });
            setMessage(`Selected cell (${x}, ${y}) for unit creation. Click "Create Unit" button.`);
            return;
        }

        // Check if this is a unit's turn
        const currentUnit = gameState.units[gameState.currentUnitTurn];
        if (!currentUnit || !currentUnit.isOwned) {
            if (gameState.myUnits.length > 0) {
                setMessage("Not your turn! Wait for your unit's turn to move.");
            } else {
                setMessage("You don't have any units. Create a unit first!");
            }
            return;
        }

        // If unit selected, try to move
        if (selectedUnitId !== null) {
            const unit = gameState.units[selectedUnitId];
            if (unit && unit.isOwned && unit.x !== null && unit.y !== null) {
                // Check if move is within 1 tile
                const dx = Math.abs(x - unit.x);
                const dy = Math.abs(y - unit.y);
                if (dx + dy <= 1) {
                    handleMoveUnit(selectedUnitId, x, y);
                } else {
                    setMessage("Can only move 1 tile at a time!");
                }
            }
        } else {
            // Select cell for unit creation or selection
            setSelectedCell({ x, y });
            if (gameState.myUnits.length === 0) {
                setMessage(`Selected cell (${x}, ${y}) for unit creation.`);
            }
        }
    };

    const handleUnitSelect = (unitId: number) => {
        if (!gameState) return;
        const unit = gameState.units[unitId];
        if (unit && unit.isOwned && gameState.currentUnitTurn === unitId) {
            setSelectedUnitId(unitId);
            setMessage(`Selected unit ${unitId} for movement`);
        } else {
            setMessage("Cannot select this unit (not your turn or not owned)");
        }
    };

    const getCellColor = (cell: {terrainType: number | null, hasTrap: boolean | null, hasLoot: boolean | null}) => {
        if (cell.terrainType === null) return '#333'; // Fog of war
        if (cell.terrainType === 0) return '#8B4513'; // Plain
        if (cell.terrainType === 1) return '#228B22'; // Forest
        if (cell.terrainType === 2) return '#696969'; // Wall
        return '#DDD';
    };

    const getCellContent = (x: number, y: number) => {
        if (!gameState) return null;
        
        // Check for units at this position
        const unit = gameState.units.find(u => u.x === x && u.y === y && u.alive);
        if (unit) {
            const isMyUnit = unit.isOwned;
            const isCurrentTurn = gameState.currentUnitTurn === unit.id;
            return (
                <div style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                    fontWeight: 'bold',
                    color: isMyUnit ? '#FFD700' : '#FF0000',
                    border: isCurrentTurn ? '2px solid #00FF00' : 'none',
                    borderRadius: '50%',
                    background: isMyUnit ? 'rgba(255, 215, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)',
                }}>
                    {unit.id}
                </div>
            );
        }
        
        // Check for trap/loot
        const cell = gameState.grid[y][x];
        if (cell.hasTrap) return '⚠️';
        if (cell.hasLoot) return '💰';
        
        return null;
    };

    return (
        <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
            <h1>Fog-of-War Grid Tactics</h1>
            
            <div style={{ marginBottom: 20 }}>
                <p><strong>Account:</strong> {account || "Not connected"}</p>
                <p><strong>SDK Status:</strong> {isInitialized ? "✅ Initialized" : "❌ Not Initialized"}</p>
                {error && <p style={{ color: 'red' }}>Error: {error}</p>}
                {message && <p style={{ color: message.includes('Error') || message.includes('failed') ? 'red' : 'green' }}>{message}</p>}
            </div>

            {!account && (
                <button onClick={connect} style={{ padding: '10px 20px', fontSize: '16px', marginBottom: 20 }}>
                    Connect Wallet
                </button>
            )}

            {isInitialized && account && (
                <>
                    <div style={{ marginBottom: 20 }}>
                        <button 
                            onClick={handleRegisterPlayer}
                            disabled={loading}
                            style={{ padding: '10px 20px', marginRight: 10 }}
                        >
                            Register Player
                        </button>
                        <button 
                            onClick={() => refreshGameState(false)}
                            disabled={loading}
                            style={{ padding: '10px 20px', marginRight: 10 }}
                        >
                            Refresh Game State
                        </button>
                        <button 
                            onClick={() => refreshGameState(true)}
                            disabled={loading}
                            style={{ padding: '10px 20px', marginRight: 10 }}
                            title="This will request signature to decrypt your data"
                        >
                            🔐 Load & Decrypt Vision
                        </button>
                        {selectedCell && (
                            <button 
                                onClick={handleCreateUnit}
                                disabled={loading}
                                style={{ padding: '10px 20px' }}
                            >
                                Create Unit at ({selectedCell.x}, {selectedCell.y})
                            </button>
                        )}
                    </div>

                    {gameState && (
                        <>
                            <div style={{ marginBottom: 20, padding: 10, background: '#f0f0f0', borderRadius: 5 }}>
                                <h3>Game Info</h3>
                                <p><strong>Round:</strong> {gameState.currentRound}</p>
                                {gameState.units.length > 0 ? (
                                    <>
                                        <p><strong>Current Turn:</strong> Unit {gameState.currentUnitTurn}</p>
                                        <p><strong>Total Units:</strong> {gameState.units.length}</p>
                                    </>
                                ) : (
                                    <p style={{ color: '#666', fontStyle: 'italic' }}>No units in game yet. Create your first unit!</p>
                                )}
                                <p><strong>Your Units:</strong> {gameState.myUnits.length > 0 ? gameState.myUnits.join(', ') : 'None - Create one to start playing!'}</p>
                                {gameState.myUnits.length === 0 && (
                                    <p style={{ color: '#ff6b00', fontWeight: 'bold', marginTop: 10 }}>
                                        💡 Tip: Click a cell on the grid, then click "Create Unit" button above
                                    </p>
                                )}
                            </div>

                            {/* Game Grid */}
                            <div style={{ marginBottom: 20 }}>
                                <h3>Game Grid (8x8)</h3>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(8, 1fr)',
                                    gap: 2,
                                    width: '640px',
                                    margin: '0 auto',
                                    border: '2px solid #000',
                                    padding: 5,
                                    background: '#000'
                                }}>
                                    {gameState.grid.map((row, y) =>
                                        row.map((cell, x) => (
                                            <div
                                                key={`${x}-${y}`}
                                                onClick={() => handleCellClick(x, y)}
                                                style={{
                                                    width: 70,
                                                    height: 70,
                                                    background: getCellColor(cell),
                                                    border: selectedCell?.x === x && selectedCell?.y === y 
                                                        ? '3px solid #00FF00' 
                                                        : '1px solid #555',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    position: 'relative',
                                                }}
                                                title={`Cell (${x}, ${y})`}
                                            >
                                                {getCellContent(x, y)}
                                                {cell.terrainType === null && (
                                                    <span style={{ fontSize: '12px', color: '#666' }}>?</span>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Units List */}
                            <div style={{ marginTop: 20 }}>
                                <h3>Units</h3>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                    {gameState.units.map((unit) => (
                                        <div
                                            key={unit.id}
                                            onClick={() => handleUnitSelect(unit.id)}
                                            style={{
                                                padding: 10,
                                                border: selectedUnitId === unit.id 
                                                    ? '3px solid #00FF00' 
                                                    : unit.isOwned 
                                                        ? '2px solid #FFD700' 
                                                        : '1px solid #CCC',
                                                borderRadius: 5,
                                                background: unit.isOwned ? '#FFFACD' : '#F5F5F5',
                                                cursor: unit.isOwned && gameState.currentUnitTurn === unit.id ? 'pointer' : 'default',
                                                minWidth: 150,
                                            }}
                                        >
                                            <p><strong>Unit {unit.id}</strong></p>
                                            <p>Owner: {unit.owner.slice(0, 6)}...{unit.owner.slice(-4)}</p>
                                            {unit.x !== null && unit.y !== null && (
                                                <p>Position: ({unit.x}, {unit.y})</p>
                                            )}
                                            {unit.hp !== null && (
                                                <p>HP: {unit.hp}</p>
                                            )}
                                            {unit.alive !== null && (
                                                <p>Alive: {unit.alive ? '✅' : '❌'}</p>
                                            )}
                                            {gameState.currentUnitTurn === unit.id && (
                                                <p style={{ color: 'green', fontWeight: 'bold' }}>Current Turn</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Legend */}
                            <div style={{ marginTop: 20, padding: 10, background: '#f0f0f0', borderRadius: 5 }}>
                                <h4>Legend</h4>
                                <p>🟫 Plain | 🟩 Forest | ⬛ Wall | ⬜ Fog of War (Unknown)</p>
                                <p>⚠️ Trap | 💰 Loot | 🟡 Your Unit | 🔴 Enemy Unit</p>
                                <p>Click a cell to select, then click adjacent cell to move (1 tile max)</p>
                            </div>
                        </>
                    )}

                    {loading && (
                        <div style={{ marginTop: 20, textAlign: 'center' }}>
                            <p>Loading...</p>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

export default App
