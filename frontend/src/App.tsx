import { useState, useEffect } from 'react'
import { BrowserProvider } from 'ethers'
import { useFhevm } from './components/FhevmProvider'
import {
    createGame,
    placeShips,
    shoot,
    revealBoard,
    getGame,
    getShots,
    decryptHitMiss,
    getStandardShips,
    generateSalt,
    createCommitment,
    findPlayerGames,
    GameInfo,
    ShipPlacement,
    TOTAL_SEGMENTS,
    BOARD_WIDTH,
    BOARD_HEIGHT,
} from './utils/battleshipUtils'

function App() {
    const { isInitialized, account, connect, error } = useFhevm();
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string>('');
    const [gameId, setGameId] = useState<number | null>(null);
    const [gameInfo, setGameInfo] = useState<GameInfo | null>(null);
    const [ships, setShips] = useState<ShipPlacement[]>([]);
    const [salt, setSalt] = useState<string>('');
    const [opponent, setOpponent] = useState<string>('');
    const [shots, setShots] = useState<any[]>([]);
    const [selectedCell, setSelectedCell] = useState<{x: number, y: number} | null>(null);
    const [playerGames, setPlayerGames] = useState<Array<{gameId: number, game: GameInfo}>>([]);
    const [loadingGames, setLoadingGames] = useState(false);

    useEffect(() => {
        if (isInitialized && account && gameId !== null) {
            refreshGame();
        }
    }, [isInitialized, account, gameId]);

    // Auto-refresh game state periodically when in Playing phase
    useEffect(() => {
        if (!gameInfo || gameInfo.phase !== 2 || !gameId) return; // Only in Playing phase
        
        const interval = setInterval(() => {
            refreshGame();
        }, 5000); // Refresh every 5 seconds
        
        return () => clearInterval(interval);
    }, [gameInfo?.phase, gameId]);

    useEffect(() => {
        if (isInitialized && account) {
            loadPlayerGames();
        } else {
            setPlayerGames([]);
            setGameId(null);
        }
    }, [isInitialized, account]);

    const loadPlayerGames = async () => {
        if (!window.ethereum || !account) return;
        setLoadingGames(true);
        try {
            const provider = new BrowserProvider(window.ethereum);
            const games = await findPlayerGames(account, provider);
            setPlayerGames(games);
            
            // Auto-load first game if available
            if (games.length > 0 && gameId === null) {
                setGameId(games[0].gameId);
                setGameInfo(games[0].game);
            }
        } catch (error: any) {
            console.error("Load player games error:", error);
        } finally {
            setLoadingGames(false);
        }
    };

    const refreshGame = async () => {
        if (!window.ethereum || !account || gameId === null) return;
        try {
            const provider = new BrowserProvider(window.ethereum);
            
            // Wait a bit for blockchain state to update
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const game = await getGame(gameId, provider);
            console.log("Refreshed game state:", { 
                phase: game.phase, 
                turn: game.turn, 
                shotCount: game.shotCount,
                currentAccount: account 
            });
            setGameInfo(game);
            
            const gameShots = await getShots(gameId, provider);
            setShots(gameShots);
            
            // Refresh games list
            await loadPlayerGames();
        } catch (error: any) {
            console.error("Refresh game error:", error);
        }
    };

    const handleSelectGame = (selectedGameId: number) => {
        setGameId(selectedGameId);
        const selectedGame = playerGames.find(g => g.gameId === selectedGameId);
        if (selectedGame) {
            setGameInfo(selectedGame.game);
        }
    };

    const handleCreateGame = async () => {
        if (!window.ethereum || !account) {
            setMessage("Please connect wallet");
            return;
        }
        // If no opponent specified, create game with self (for testing)
        const opponentAddress = opponent || account;
        setLoading(true);
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const newGameId = await createGame(opponentAddress, signer);
            setGameId(newGameId);
            if (opponentAddress.toLowerCase() === account.toLowerCase()) {
                setMessage(`Game ${newGameId} created (self-play mode for testing)! You can play both sides.`);
            } else {
                setMessage(`Game ${newGameId} created! Both players need to place ships.`);
            }
            await loadPlayerGames();
        } catch (error: any) {
            console.error("Create game error:", error);
            setMessage("Failed to create game: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePlaceShips = async () => {
        if (!window.ethereum || !account || gameId === null) {
            setMessage("Please connect wallet and create/join a game first");
            return;
        }
        if (ships.length !== TOTAL_SEGMENTS) {
            setMessage(`Please place exactly ${TOTAL_SEGMENTS} ship segments (currently ${ships.length})`);
            return;
        }
        setLoading(true);
        setMessage("Packing coordinates and encrypting (this may take a moment)...");
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const newSalt = salt || generateSalt();
            setSalt(newSalt);
            
            console.log("Placing ships:", { gameId, shipsCount: ships.length, salt: newSalt });
            setMessage("Encrypting ship coordinates (1 signature request for all 34 coordinates)...");
            
            await placeShips(gameId, ships, newSalt, account, signer);
            
            setMessage("✅ Ships placed successfully! Waiting for opponent to place their ships...");
            await refreshGame();
        } catch (error: any) {
            console.error("Place ships error:", error);
            const errorMsg = error.message || error.toString() || "Unknown error";
            setMessage(`❌ Failed to place ships: ${errorMsg}`);
            // Show more details in console
            if (error.data) {
                console.error("Error data:", error.data);
            }
            if (error.reason) {
                console.error("Error reason:", error.reason);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleShoot = async (x: number, y: number) => {
        if (!window.ethereum || !account || gameId === null) return;
        
        // Re-check turn right before shooting (in case state changed)
        const provider = new BrowserProvider(window.ethereum);
        const currentGame = await getGame(gameId, provider);
        if (currentGame.turn.toLowerCase() !== account.toLowerCase()) {
            const turnPlayer = currentGame.turn.toLowerCase() === currentGame.p1.toLowerCase() ? 'Player 1' : 'Player 2';
            setMessage(`⏳ Not your turn! It's ${turnPlayer}'s turn (${currentGame.turn.slice(0, 6)}...${currentGame.turn.slice(-4)})`);
            // Update gameInfo to reflect current state
            setGameInfo(currentGame);
            return;
        }
        
        setLoading(true);
        try {
            const signer = await provider.getSigner();
            
            setMessage(`🎯 Shooting at (${x}, ${y})...`);
            const hitCipher = await shoot(gameId, x, y, signer);
            
            setMessage(`✅ Shot fired! Decrypting result...`);
            
            // Decrypt hit/miss
            const isHit = await decryptHitMiss(hitCipher, account);
            setMessage(`🎯 Shot at (${x}, ${y}): ${isHit ? 'HIT! 🎯' : 'MISS 💨'}. Refreshing game state...`);
            
            // Wait for transaction to be fully processed
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Refresh game state to update turn
            await refreshGame();
            
            // Double check turn after refresh
            const updatedGame = await getGame(gameId, provider);
            const newTurn = updatedGame.turn.toLowerCase();
            const currentAccount = account.toLowerCase();
            
            if (newTurn !== currentAccount) {
                const nextPlayer = newTurn === updatedGame.p1.toLowerCase() ? 'Player 1' : 'Player 2';
                setMessage(`✅ Turn switched! It's now ${nextPlayer}'s turn (${updatedGame.turn.slice(0, 6)}...${updatedGame.turn.slice(-4)}). You can click "Refresh Game" if needed.`);
            } else {
                setMessage(`⚠️ Turn didn't switch. This might be a bug. Please refresh manually.`);
            }
        } catch (error: any) {
            console.error("Shoot error:", error);
            setMessage("❌ Failed to shoot: " + error.message);
            // Refresh anyway to get latest state
            await refreshGame();
        } finally {
            setLoading(false);
        }
    };

    const handleRevealBoard = async () => {
        if (!window.ethereum || !account || gameId === null) return;
        if (ships.length !== TOTAL_SEGMENTS || !salt) {
            setMessage("Please place ships first");
            return;
        }
        setLoading(true);
        try {
            const provider = new BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            await revealBoard(gameId, ships, salt, signer);
            setMessage("Board revealed! Waiting for opponent...");
            await refreshGame();
        } catch (error: any) {
            console.error("Reveal board error:", error);
            setMessage("Failed to reveal board: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUseStandardShips = () => {
        const standard = getStandardShips();
        setShips(standard);
        setMessage(`Loaded standard ship configuration (${standard.length} segments)`);
    };

    const handleCellClick = (x: number, y: number) => {
        if (!gameInfo) return;
        
        // If placing ships, add/remove segment
        if (gameInfo.phase === 1) { // Placing phase
            const existingIndex = ships.findIndex(s => s.x === x && s.y === y);
            if (existingIndex >= 0) {
                // Remove segment
                setShips(ships.filter((_, i) => i !== existingIndex));
                setMessage(`Removed segment at (${x}, ${y}). ${ships.length - 1}/${TOTAL_SEGMENTS} segments`);
            } else {
                // Add segment
                if (ships.length >= TOTAL_SEGMENTS) {
                    setMessage(`Maximum ${TOTAL_SEGMENTS} segments allowed`);
                    return;
                }
                setShips([...ships, { x, y }]);
                setMessage(`Added segment at (${x}, ${y}). ${ships.length + 1}/${TOTAL_SEGMENTS} segments`);
            }
        } else if (gameInfo.phase === 2 && gameInfo.turn.toLowerCase() === account?.toLowerCase()) {
            // Playing phase - shoot
            setSelectedCell({ x, y });
            handleShoot(x, y);
        }
    };

    const renderBoard = (isOpponent: boolean = false) => {
        const board: JSX.Element[] = [];
        for (let y = 0; y < BOARD_HEIGHT; y++) {
            for (let x = 0; x < BOARD_WIDTH; x++) {
                const cellKey = `${x}-${y}`;
                const isShip = ships.some(s => s.x === x && s.y === y);
                const shot = shots.find(s => s.x === x && s.y === y);
                const isMyShot = shot && shot.shooter.toLowerCase() === account?.toLowerCase();
                
                let cellContent = '';
                let cellColor = '#87CEEB'; // Sky blue (water)
                
                if (isShip && !isOpponent) {
                    cellColor = '#8B4513'; // Brown (ship)
                }
                
                if (shot) {
                    if (isMyShot) {
                        // Show hit/miss for my shots (would need to decrypt)
                        cellContent = '?'; // Placeholder - would show HIT/MISS after decrypt
                    } else {
                        cellContent = '💥'; // Opponent's shot
                    }
                }
                
                board.push(
                    <div
                        key={cellKey}
                        onClick={() => handleCellClick(x, y)}
                        style={{
                            width: 30,
                            height: 30,
                            background: cellColor,
                            border: '1px solid #333',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '16px',
                        }}
                        title={`Cell (${x}, ${y})`}
                    >
                        {cellContent}
                    </div>
                );
            }
        }
        return board;
    };

    return (
        <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
            <h1>🔫 FHE Battleship</h1>
            
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
                    {/* My Games List */}
                    <div style={{ marginBottom: 20, padding: 15, background: '#e7f3ff', borderRadius: 5 }}>
                        <h3>My Games</h3>
                        {loadingGames ? (
                            <p>Loading games...</p>
                        ) : playerGames.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                {playerGames.map(({ gameId: gId, game }) => (
                                    <div
                                        key={gId}
                                        onClick={() => handleSelectGame(gId)}
                                        style={{
                                            padding: 10,
                                            border: gId === gameId ? '3px solid #00FF00' : '2px solid #333',
                                            borderRadius: 5,
                                            background: gId === gameId ? '#fff' : '#f5f5f5',
                                            cursor: 'pointer',
                                            minWidth: 200,
                                        }}
                                    >
                                        <p><strong>Game #{gId}</strong></p>
                                        <p>P1: {game.p1.slice(0, 6)}...{game.p1.slice(-4)}</p>
                                        <p>P2: {game.p2.slice(0, 6)}...{game.p2.slice(-4)}</p>
                                        <p>Phase: {['Waiting', 'Placing', 'Playing', 'Reveal', 'Finished'][game.phase]}</p>
                                        <p>Shots: {game.shotCount}</p>
                                        {game.winner !== '0x0000000000000000000000000000000000000000' && (
                                            <p><strong>Winner: {game.winner.slice(0, 6)}...{game.winner.slice(-4)}</strong></p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p>No games found. Create a new game below.</p>
                        )}
                        <button
                            onClick={loadPlayerGames}
                            disabled={loadingGames}
                            style={{ padding: '10px 20px', marginTop: 10 }}
                        >
                            🔄 Refresh Games
                        </button>
                    </div>

                    {/* Game Setup */}
                    <div style={{ marginBottom: 20, padding: 15, background: '#f0f0f0', borderRadius: 5 }}>
                        <h3>Create New Game</h3>
                        <input
                            type="text"
                            placeholder="Opponent address (leave empty for self-play/test)"
                            value={opponent}
                            onChange={(e) => setOpponent(e.target.value)}
                            style={{ padding: '10px', width: '400px', marginRight: 10 }}
                        />
                        <button
                            onClick={handleCreateGame}
                            disabled={loading}
                            style={{ padding: '10px 20px', marginRight: 10 }}
                        >
                            Create Game
                        </button>
                        <button
                            onClick={() => {
                                setOpponent(account || '');
                                setMessage("Opponent set to your address (self-play mode)");
                            }}
                            style={{ padding: '10px 20px', background: '#17a2b8', color: 'white', border: 'none', borderRadius: 5 }}
                            title="Create game with yourself for testing"
                        >
                            🧪 Self-Play (Test)
                        </button>
                        <p style={{ marginTop: 10, fontSize: '12px', color: '#666' }}>
                            💡 Tip: Leave opponent empty or click "Self-Play" to test with 1 wallet. For real game, enter opponent's address.
                        </p>
                    </div>

                    {/* Game Info */}
                    {gameInfo && (
                        <div style={{ marginBottom: 20, padding: 15, background: '#f0f0f0', borderRadius: 5 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <h3 style={{ margin: 0 }}>Game #{gameId}</h3>
                                <button
                                    onClick={refreshGame}
                                    disabled={loading}
                                    style={{ padding: '5px 15px', background: '#17a2b8', color: 'white', border: 'none', borderRadius: 5, cursor: loading ? 'not-allowed' : 'pointer' }}
                                    title="Refresh game state"
                                >
                                    🔄 Refresh
                                </button>
                            </div>
                            <p><strong>Phase:</strong> {['Waiting', 'Placing', 'Playing', 'Reveal', 'Finished'][gameInfo.phase]}</p>
                            <p><strong>Player 1:</strong> {gameInfo.p1.slice(0, 6)}...{gameInfo.p1.slice(-4)} {gameInfo.p1.toLowerCase() === account?.toLowerCase() && <span style={{ color: 'green' }}>(You)</span>}</p>
                            <p><strong>Player 2:</strong> {gameInfo.p2.slice(0, 6)}...{gameInfo.p2.slice(-4)} {gameInfo.p2.toLowerCase() === account?.toLowerCase() && <span style={{ color: 'green' }}>(You)</span>}</p>
                            <p>
                                <strong>Current Turn:</strong> {gameInfo.turn.slice(0, 6)}...{gameInfo.turn.slice(-4)}
                                {gameInfo.turn.toLowerCase() === account?.toLowerCase() && (
                                    <span style={{ color: 'green', fontWeight: 'bold', marginLeft: 10 }}>✓ Your Turn!</span>
                                )}
                                {gameInfo.turn.toLowerCase() !== account?.toLowerCase() && gameInfo.phase === 2 && (
                                    <span style={{ color: 'orange', marginLeft: 10 }}>⏳ Waiting for opponent...</span>
                                )}
                            </p>
                            <p><strong>Shots:</strong> {gameInfo.shotCount}</p>
                            {gameInfo.winner !== '0x0000000000000000000000000000000000000000' && (
                                <p><strong>Winner:</strong> {gameInfo.winner}</p>
                            )}
                        </div>
                    )}

                    {/* Ship Placement */}
                    {gameInfo && gameInfo.phase === 1 && (
                        <div style={{ marginBottom: 20, padding: 15, background: '#fff3cd', borderRadius: 5 }}>
                            <h3>Place Your Ships ({ships.length}/{TOTAL_SEGMENTS} segments)</h3>
                            <p>Click cells to place ship segments. Click again to remove.</p>
                            <button
                                onClick={handleUseStandardShips}
                                style={{ padding: '10px 20px', marginRight: 10, marginBottom: 10 }}
                            >
                                Use Standard Ships
                            </button>
                            <button
                                onClick={handlePlaceShips}
                                disabled={loading || ships.length !== TOTAL_SEGMENTS}
                                style={{ padding: '10px 20px', background: '#28a745', color: 'white', border: 'none', borderRadius: 5 }}
                            >
                                Place Ships
                            </button>
                        </div>
                    )}

                    {/* Game Board */}
                    {gameInfo && (
                        <div style={{ marginBottom: 20 }}>
                            <h3>Your Board (10x10)</h3>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: `repeat(${BOARD_WIDTH}, 1fr)`,
                                gap: 2,
                                width: 'fit-content',
                                border: '2px solid #000',
                                padding: 5,
                                background: '#000'
                            }}>
                                {renderBoard(false)}
                            </div>
                        </div>
                    )}

                    {/* Reveal Button */}
                    {gameInfo && gameInfo.phase === 3 && (
                        <div style={{ marginBottom: 20 }}>
                            <button
                                onClick={handleRevealBoard}
                                disabled={loading}
                                style={{ padding: '10px 20px', background: '#17a2b8', color: 'white', border: 'none', borderRadius: 5 }}
                            >
                                Reveal Board
                            </button>
                        </div>
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
