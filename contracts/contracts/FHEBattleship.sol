// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint8, ebool, externalEuint8 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title FHE Battleship - Private Board Game with FHE
/// @notice Encrypt board once at setup, shoot with public coordinates
contract FHEBattleship is ZamaEthereumConfig {
    uint8 public constant W = 10;
    uint8 public constant H = 10;
    uint8 public constant TOTAL_SEGMENTS = 17; // Standard Battleship: 5 ships = 17 segments

    enum Phase { Waiting, Placing, Playing, Reveal, Finished }

    struct BoardEnc {
        bool placed;
        bytes32 commitment;        // keccak(clearCoords || salt)
        euint8[TOTAL_SEGMENTS] xs;
        euint8[TOTAL_SEGMENTS] ys;
    }

    struct RevealClear {
        bool revealed;
        uint8[TOTAL_SEGMENTS] xs;
        uint8[TOTAL_SEGMENTS] ys;
    }

    struct Shot {
        address shooter;
        uint8 x;
        uint8 y;
        // encrypted hit/miss for shooter only
        ebool hitCipher;
    }

    struct Game {
        address p1;
        address p2;
        Phase phase;
        address turn;       // who can shoot
        uint32 shotCount;
        address winner;
    }

    uint256 public nextGameId;
    mapping(uint256 => Game) public games;
    mapping(uint256 => mapping(address => BoardEnc)) internal boards;
    mapping(uint256 => mapping(address => RevealClear)) internal reveals;
    mapping(uint256 => mapping(address => mapping(uint16 => bool))) public shotUsed; // index=x+y*W (public)
    mapping(uint256 => Shot[]) public shots;

    event GameCreated(uint256 indexed gameId, address p1, address p2);
    event ShipPlaced(uint256 indexed gameId, address player);
    event GameStarted(uint256 indexed gameId);
    event ShotFired(uint256 indexed gameId, address shooter, uint8 x, uint8 y);
    event BoardRevealed(uint256 indexed gameId, address player);
    event GameFinished(uint256 indexed gameId, address winner);

    /// @notice Create a new game
    /// @param opponent Opponent address (can be same as msg.sender for testing)
    function createGame(address opponent) external returns (uint256 gameId) {
        require(opponent != address(0), "Invalid opponent");
        // Allow self-play for testing (remove check: opponent != msg.sender)
        gameId = nextGameId++;
        
        games[gameId] = Game({
            p1: msg.sender,
            p2: opponent,
            phase: Phase.Placing,
            turn: address(0),
            shotCount: 0,
            winner: address(0)
        });

        emit GameCreated(gameId, msg.sender, opponent);
        return gameId;
    }

    /// @notice Place ships - encrypt once at setup
    /// @param coords Array of 34 externalEuint8: [x0,y0, x1,y1, ..., x16,y16]
    /// @param inputProof Single proof for all 34 coordinates (packed)
    /// @param commitment keccak256(clearCoords || salt)
    function placeShips(
        uint256 gameId,
        externalEuint8[] calldata coords, // length = 34
        bytes calldata inputProof,
        bytes32 commitment
    ) external {
        Game storage g = games[gameId];
        require(g.phase == Phase.Placing, "bad phase");
        require(msg.sender == g.p1 || msg.sender == g.p2, "not player");
        require(coords.length == 2 * TOTAL_SEGMENTS, "bad coords len");

        BoardEnc storage b = boards[gameId][msg.sender];
        require(!b.placed, "already placed");

        b.commitment = commitment;

        for (uint8 i = 0; i < TOTAL_SEGMENTS; i++) {
            euint8 ex = FHE.fromExternal(coords[2*i], inputProof);
            euint8 ey = FHE.fromExternal(coords[2*i + 1], inputProof);

            // Clamp coordinates within bounds
            euint8 maxX = FHE.asEuint8(W - 1);
            euint8 maxY = FHE.asEuint8(H - 1);
            ex = FHE.select(FHE.gt(ex, maxX), maxX, ex);
            ey = FHE.select(FHE.gt(ey, maxY), maxY, ey);

            b.xs[i] = ex;
            b.ys[i] = ey;

            // IMPORTANT: Allow contract to use these later
            FHE.allowThis(b.xs[i]);
            FHE.allowThis(b.ys[i]);
        }

        b.placed = true;
        emit ShipPlaced(gameId, msg.sender);

        // If both placed -> start game
        if (boards[gameId][g.p1].placed && boards[gameId][g.p2].placed) {
            g.phase = Phase.Playing;
            g.turn = g.p1;
            emit GameStarted(gameId);
        }
    }

    /// @notice Shoot at opponent's board - public coordinates, encrypted hit/miss
    /// @param x Public x coordinate (0-9)
    /// @param y Public y coordinate (0-9)
    /// @return hitCipher Encrypted hit/miss (only shooter can decrypt)
    function shoot(uint256 gameId, uint8 x, uint8 y) external returns (ebool hitCipher) {
        Game storage g = games[gameId];
        require(g.phase == Phase.Playing, "bad phase");
        require(msg.sender == g.turn, "not your turn");
        require(x < W && y < H, "OOB");

        uint16 idx = uint16(x) + uint16(y) * uint16(W);
        require(!shotUsed[gameId][msg.sender][idx], "repeat shot");
        shotUsed[gameId][msg.sender][idx] = true;

        address defender = (msg.sender == g.p1) ? g.p2 : g.p1;
        BoardEnc storage b = boards[gameId][defender];
        require(b.placed, "defender not placed");

        euint8 ex = FHE.asEuint8(x);
        euint8 ey = FHE.asEuint8(y);

        // Check if shot hits any segment
        ebool hit = FHE.asEbool(false);
        for (uint8 i = 0; i < TOTAL_SEGMENTS; i++) {
            ebool sameX = FHE.eq(b.xs[i], ex);
            ebool sameY = FHE.eq(b.ys[i], ey);
            ebool same = FHE.and(sameX, sameY);
            hit = FHE.or(hit, same);
        }

        // Store shot + grant ACL for shooter to decrypt
        Shot memory s;
        s.shooter = msg.sender;
        s.x = x;
        s.y = y;
        s.hitCipher = hit;
        shots[gameId].push(s);

        FHE.allowThis(hit);
        FHE.allow(hit, msg.sender); // Shooter can decrypt off-chain

        // Switch turn (alternating)
        g.turn = defender;
        g.shotCount += 1;

        emit ShotFired(gameId, msg.sender, x, y);
        return hit;
    }

    /// @notice Reveal board with clear coordinates and salt
    function revealBoard(
        uint256 gameId,
        uint8[TOTAL_SEGMENTS] calldata xs,
        uint8[TOTAL_SEGMENTS] calldata ys,
        bytes32 salt
    ) external {
        Game storage g = games[gameId];
        require(g.phase == Phase.Playing || g.phase == Phase.Reveal, "bad phase");
        require(msg.sender == g.p1 || msg.sender == g.p2, "not player");

        BoardEnc storage b = boards[gameId][msg.sender];
        require(b.placed, "not placed");

        bytes32 c = keccak256(abi.encodePacked(xs, ys, salt));
        require(c == b.commitment, "bad reveal");

        RevealClear storage r = reveals[gameId][msg.sender];
        r.revealed = true;
        r.xs = xs;
        r.ys = ys;

        g.phase = Phase.Reveal;
        emit BoardRevealed(gameId, msg.sender);

        // If both revealed, finalize winner
        if (reveals[gameId][g.p1].revealed && reveals[gameId][g.p2].revealed) {
            _finalizeWinner(gameId);
        }
    }

    /// @notice Finalize winner by checking shot history against revealed boards
    function _finalizeWinner(uint256 gameId) internal {
        Game storage g = games[gameId];
        require(g.phase == Phase.Reveal, "not in reveal phase");
        require(reveals[gameId][g.p1].revealed && reveals[gameId][g.p2].revealed, "both must reveal");

        // Track hits for each player
        uint8 p1Hits = 0;
        uint8 p2Hits = 0;
        uint32 p1FinishShot = type(uint32).max;
        uint32 p2FinishShot = type(uint32).max;

        RevealClear memory p1Board = reveals[gameId][g.p1];
        RevealClear memory p2Board = reveals[gameId][g.p2];

        // Check all shots against revealed boards
        for (uint32 i = 0; i < shots[gameId].length; i++) {
            Shot memory shot = shots[gameId][i];
            
            if (shot.shooter == g.p1) {
                // Check if p1's shot hits p2's board
                bool hit = false;
                for (uint8 j = 0; j < TOTAL_SEGMENTS; j++) {
                    if (p2Board.xs[j] == shot.x && p2Board.ys[j] == shot.y) {
                        hit = true;
                        break;
                    }
                }
                if (hit) {
                    p1Hits++;
                    if (p1Hits == TOTAL_SEGMENTS && p1FinishShot == type(uint32).max) {
                        p1FinishShot = i;
                    }
                }
            } else if (shot.shooter == g.p2) {
                // Check if p2's shot hits p1's board
                bool hit = false;
                for (uint8 j = 0; j < TOTAL_SEGMENTS; j++) {
                    if (p1Board.xs[j] == shot.x && p1Board.ys[j] == shot.y) {
                        hit = true;
                        break;
                    }
                }
                if (hit) {
                    p2Hits++;
                    if (p2Hits == TOTAL_SEGMENTS && p2FinishShot == type(uint32).max) {
                        p2FinishShot = i;
                    }
                }
            }
        }

        // Determine winner: first to sink all 17 segments wins
        if (p1FinishShot < p2FinishShot) {
            g.winner = g.p1;
        } else if (p2FinishShot < p1FinishShot) {
            g.winner = g.p2;
        } else if (p1Hits == TOTAL_SEGMENTS && p2Hits == TOTAL_SEGMENTS) {
            // Both finished in same shot (rare but possible)
            g.winner = g.p1; // p1 wins by default (first player)
        }
        // If neither finished, winner remains address(0) - draw

        g.phase = Phase.Finished;
        emit GameFinished(gameId, g.winner);
    }

    /// @notice Get game info
    function getGame(uint256 gameId) external view returns (Game memory) {
        return games[gameId];
    }

    /// @notice Get shot count
    function getShotCount(uint256 gameId) external view returns (uint32) {
        return games[gameId].shotCount;
    }

    /// @notice Get shot at index
    function getShot(uint256 gameId, uint32 index) external view returns (Shot memory) {
        require(index < shots[gameId].length, "invalid index");
        return shots[gameId][index];
    }

    /// @notice Get all shots for a game
    function getShots(uint256 gameId) external view returns (Shot[] memory) {
        return shots[gameId];
    }

    /// @notice Check if board is placed
    function isBoardPlaced(uint256 gameId, address player) external view returns (bool) {
        return boards[gameId][player].placed;
    }

    /// @notice Check if board is revealed
    function isBoardRevealed(uint256 gameId, address player) external view returns (bool) {
        return reveals[gameId][player].revealed;
    }

    /// @notice Get all game IDs where player is p1 or p2
    /// Note: This is a view function that scans games (may be gas intensive for many games)
    /// For production, consider using events or off-chain indexing
    function getPlayerGames(address player) external view returns (uint256[] memory) {
        uint256[] memory gameIds = new uint256[](nextGameId);
        uint256 count = 0;
        
        for (uint256 i = 0; i < nextGameId; i++) {
            Game memory g = games[i];
            if (g.p1 == player || g.p2 == player) {
                gameIds[count] = i;
                count++;
            }
        }
        
        // Resize array to actual count
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = gameIds[i];
        }
        
        return result;
    }

    /// @notice Get next game ID (for scanning)
    function getNextGameId() external view returns (uint256) {
        return nextGameId;
    }
}
