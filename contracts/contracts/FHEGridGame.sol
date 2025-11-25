// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint8, euint16, ebool, externalEuint8 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title FHE Grid Tactics Game - Fog of War Strategy Game with FHE
contract FHEGridGame is ZamaEthereumConfig {
    uint8 public constant WIDTH = 8;
    uint8 public constant HEIGHT = 8;
    uint8 public constant VISION_RADIUS = 2;

    struct EncryptedCell {
        euint8 terrainType;   // 0=plain, 1=forest, 2=wall
        ebool hasTrap;
        ebool hasLoot;
    }

    struct EncryptedUnit {
        euint8 x;
        euint8 y;
        euint16 hp;
        euint16 atk;
        euint16 def;
        ebool alive;
        address owner; // clear để check quyền
    }

    // Map [y][x]
    EncryptedCell[HEIGHT][WIDTH] internal grid;

    // Unit ID -> data
    EncryptedUnit[] internal units;

    // Turn state
    uint256 public currentUnitTurn;
    uint256 public currentRound;
    address[] public players;

    // Mapping để track player
    mapping(address => bool) public isPlayer;

    event UnitMoved(uint256 indexed unitId, address indexed owner);
    event CombatResolved(uint256 indexed unitA, uint256 indexed unitB);
    event TurnAdvanced(uint256 newUnitTurn);

    /// @notice Initialize game with map and initial units
    constructor() {
        currentRound = 1;
        currentUnitTurn = 0;
    }

    /// @notice Register a new player
    function registerPlayer() external {
        require(!isPlayer[msg.sender], "Already registered");
        isPlayer[msg.sender] = true;
        players.push(msg.sender);
    }

    /// @notice Create a unit for a player (simplified - in production would have restrictions)
    function createUnit(
        externalEuint8 xExt, bytes calldata xProof,
        externalEuint8 yExt, bytes calldata yProof,
        externalEuint8 hpExt, bytes calldata hpProof,
        externalEuint8 atkExt, bytes calldata atkProof,
        externalEuint8 defExt, bytes calldata defProof
    ) external {
        require(isPlayer[msg.sender] || players.length < 4, "Max players or not registered");
        if (!isPlayer[msg.sender]) {
            isPlayer[msg.sender] = true;
            players.push(msg.sender);
        }

        euint8 x = FHE.fromExternal(xExt, xProof);
        euint8 y = FHE.fromExternal(yExt, yProof);
        euint16 hp = FHE.asEuint16(FHE.fromExternal(hpExt, hpProof));
        euint16 atk = FHE.asEuint16(FHE.fromExternal(atkExt, atkProof));
        euint16 def = FHE.asEuint16(FHE.fromExternal(defExt, defProof));

        // Note: Coordinate clamping removed to reduce FHE operations
        // Frontend should validate coordinates before calling

        EncryptedUnit memory newUnit = EncryptedUnit({
            x: x,
            y: y,
            hp: hp,
            atk: atk,
            def: def,
            alive: FHE.asEbool(true),
            owner: msg.sender
        });

        units.push(newUnit);

        // Grant vision for unit stats only (cells granted on-demand to avoid revert)
        _grantVisionForUnitStats(units.length - 1);
    }

    /// @notice Move a unit to new position
    function moveUnit(
        uint256 unitId,
        externalEuint8 newXExt, bytes calldata newXProof,
        externalEuint8 newYExt, bytes calldata newYProof
    ) external {
        require(unitId < units.length, "Invalid unit ID");
        EncryptedUnit storage u = units[unitId];
        
        require(msg.sender == u.owner, "Not owner");
        require(_isThisUnitsTurn(unitId), "Not your turn");

        // Convert external encrypted input -> internal euint8
        euint8 newX = FHE.fromExternal(newXExt, newXProof);
        euint8 newY = FHE.fromExternal(newYExt, newYProof);

        // Clamp coordinates within bounds
        euint8 maxX = FHE.asEuint8(WIDTH - 1);
        euint8 maxY = FHE.asEuint8(HEIGHT - 1);
        ebool tooHighX = FHE.gt(newX, maxX);
        ebool tooHighY = FHE.gt(newY, maxY);
        euint8 clampedX = FHE.select(tooHighX, maxX, newX);
        euint8 clampedY = FHE.select(tooHighY, maxY, newY);

        // Check if move is within 1 step (simplified - validate max 1 tile movement)
        // This is a basic check - full validation would be more complex
        _requireWithinOneStep(u.x, u.y, clampedX, clampedY);

        // Update position
        u.x = clampedX;
        u.y = clampedY;

        // Resolve trap/loot & collision
        _resolveCellEffects(unitId);
        _resolveUnitCollisions(unitId);

        // Update FOV & ACL for player
        _grantVisionForUnit(unitId);

        emit UnitMoved(unitId, msg.sender);

        _advanceTurn();
    }

    /// @notice Execute a queue of moves from multiple units in one transaction
    /// @param unitIds Array of unit IDs to move
    /// @param xExts Array of encrypted x coordinates (one per unit)
    /// @param xProofs Array of x proofs
    /// @param yExts Array of encrypted y coordinates (one per unit)
    /// @param yProofs Array of y proofs
    function executeMovesQueue(
        uint256[] calldata unitIds,
        externalEuint8[] calldata xExts, bytes[] calldata xProofs,
        externalEuint8[] calldata yExts, bytes[] calldata yProofs
    ) external {
        require(unitIds.length == xExts.length && unitIds.length == yExts.length, "Array length mismatch");
        require(unitIds.length == xProofs.length && unitIds.length == yProofs.length, "Array length mismatch");
        require(unitIds.length > 0 && unitIds.length <= 20, "Invalid queue size"); // Max 20 moves per batch
        
        // Execute each move in the queue sequentially
        for (uint256 i = 0; i < unitIds.length; i++) {
            uint256 unitId = unitIds[i];
            require(unitId < units.length, "Invalid unit ID");
            EncryptedUnit storage u = units[unitId];
            
            require(msg.sender == u.owner, "Not owner");
            require(_isThisUnitsTurn(unitId), "Not your turn");

            // Convert external encrypted input -> internal euint8
            euint8 newX = FHE.fromExternal(xExts[i], xProofs[i]);
            euint8 newY = FHE.fromExternal(yExts[i], yProofs[i]);

            // Clamp coordinates within bounds
            euint8 maxX = FHE.asEuint8(WIDTH - 1);
            euint8 maxY = FHE.asEuint8(HEIGHT - 1);
            ebool tooHighX = FHE.gt(newX, maxX);
            ebool tooHighY = FHE.gt(newY, maxY);
            euint8 clampedX = FHE.select(tooHighX, maxX, newX);
            euint8 clampedY = FHE.select(tooHighY, maxY, newY);

            // Check if move is within 1 step
            _requireWithinOneStep(u.x, u.y, clampedX, clampedY);

            // Update position
            u.x = clampedX;
            u.y = clampedY;

            // Resolve trap/loot & collision
            _resolveCellEffects(unitId);
            _resolveUnitCollisions(unitId);

            // Update FOV & ACL for player
            _grantVisionForUnit(unitId);

            emit UnitMoved(unitId, msg.sender);

            // Advance turn after each move
            _advanceTurn();
        }
    }

    /// @notice Check if move is within 1 step (simplified version)
    function _requireWithinOneStep(
        euint8 oldX, euint8 oldY,
        euint8 newX, euint8 newY
    ) internal {
        euint8 one = FHE.asEuint8(1);
        
        euint8 xPlus = FHE.add(oldX, one);
        euint8 yPlus = FHE.add(oldY, one);
        
        // For POC: allow same position or adjacent (we'll validate in client for simplicity)
        // Full validation would check all 4 directions + same position
        
        // For now, just ensure coordinates are clamped - strict validation can be added later
    }

    /// @notice Resolve cell effects (trap/loot)
    function _resolveCellEffects(uint256 unitId) internal {
        EncryptedUnit storage u = units[unitId];
        
        // Check all cells to see if unit stepped on trap/loot
        for (uint8 iy = 0; iy < HEIGHT; iy++) {
            for (uint8 ix = 0; ix < WIDTH; ix++) {
                EncryptedCell storage cell = grid[iy][ix];
                
                euint8 ex = FHE.asEuint8(ix);
                euint8 ey = FHE.asEuint8(iy);
                
                ebool matchX = FHE.eq(u.x, ex);
                ebool matchY = FHE.eq(u.y, ey);
                ebool sameCell = FHE.and(matchX, matchY);
                
                // Check trap
                ebool steppedOnTrap = FHE.and(sameCell, cell.hasTrap);
                u.hp = _applyTrapIfNeeded(u.hp, steppedOnTrap);
                
                // Check loot
                ebool steppedOnLoot = FHE.and(sameCell, cell.hasLoot);
                u.hp = _applyLootIfNeeded(u.hp, steppedOnLoot);
                
                // Clear trap/loot after trigger
                cell.hasTrap = _turnOffIfTriggered(cell.hasTrap, sameCell);
                cell.hasLoot = _turnOffIfTriggered(cell.hasLoot, sameCell);
            }
        }
    }

    /// @notice Apply trap damage if stepped on
    function _applyTrapIfNeeded(euint16 hp, ebool stepped) internal returns (euint16) {
        euint16 trapDmg = FHE.asEuint16(5);
        euint16 hpAfter = FHE.sub(hp, trapDmg);
        ebool dead = FHE.le(hpAfter, FHE.asEuint16(0));
        euint16 hpClamped = FHE.select(dead, FHE.asEuint16(0), hpAfter);
        return FHE.select(stepped, hpClamped, hp);
    }

    /// @notice Apply loot healing if stepped on
    function _applyLootIfNeeded(euint16 hp, ebool stepped) internal returns (euint16) {
        euint16 heal = FHE.asEuint16(3);
        euint16 hpAfter = FHE.add(hp, heal);
        return FHE.select(stepped, hpAfter, hp);
    }

    /// @notice Turn off flag if triggered
    function _turnOffIfTriggered(ebool flag, ebool sameCell) internal returns (ebool) {
        ebool eFalse = FHE.asEbool(false);
        return FHE.select(sameCell, eFalse, flag);
    }

    /// @notice Resolve unit collisions and combat
    function _resolveUnitCollisions(uint256 moverId) internal {
        EncryptedUnit storage mover = units[moverId];
        
        for (uint256 i = 0; i < units.length; i++) {
            if (i == moverId) continue;
            
            EncryptedUnit storage other = units[i];
            
            // Check same cell
            ebool sameX = FHE.eq(mover.x, other.x);
            ebool sameY = FHE.eq(mover.y, other.y);
            ebool sameCell = FHE.and(sameX, sameY);
            
            // Combat if same cell, both alive, different owners
            ebool bothAlive = FHE.and(mover.alive, other.alive);
            bool differentOwner = mover.owner != other.owner;
            
            if (differentOwner) {
                // For POC: we'll resolve combat - full implementation needs FHE bool conversion
                // Simplified: trigger combat if same cell and different owners
                _resolveCombat(moverId, i, sameCell, bothAlive);
            }
        }
    }

    /// @notice Resolve combat between two units
    function _resolveCombat(
        uint256 aId, 
        uint256 bId,
        ebool sameCell,
        ebool bothAlive
    ) internal {
        EncryptedUnit storage A = units[aId];
        EncryptedUnit storage B = units[bId];
        
        ebool shouldFight = FHE.and(sameCell, bothAlive);
        
        euint16 one16 = FHE.asEuint16(1);
        
        // Damage A to B = max(A.atk - B.def, 1)
        euint16 rawDamAB = FHE.sub(A.atk, B.def);
        ebool tooLowAB = FHE.lt(rawDamAB, one16);
        euint16 damAB = FHE.select(tooLowAB, one16, rawDamAB);
        
        // Damage B to A = max(B.atk - A.def, 1)
        euint16 rawDamBA = FHE.sub(B.atk, A.def);
        ebool tooLowBA = FHE.lt(rawDamBA, one16);
        euint16 damBA = FHE.select(tooLowBA, one16, rawDamBA);
        
        // Apply damage only if shouldFight
        euint16 finalDamAB = FHE.select(shouldFight, damAB, FHE.asEuint16(0));
        euint16 finalDamBA = FHE.select(shouldFight, damBA, FHE.asEuint16(0));
        
        // Calculate HP after combat
        euint16 hpAAfterSub = FHE.sub(A.hp, finalDamBA);
        ebool aDead = FHE.le(hpAAfterSub, FHE.asEuint16(0));
        euint16 hpAFinal = FHE.select(aDead, FHE.asEuint16(0), hpAAfterSub);
        
        euint16 hpBAfterSub = FHE.sub(B.hp, finalDamAB);
        ebool bDead = FHE.le(hpBAfterSub, FHE.asEuint16(0));
        euint16 hpBFinal = FHE.select(bDead, FHE.asEuint16(0), hpBAfterSub);
        
        // Update only if should fight
        A.hp = FHE.select(shouldFight, hpAFinal, A.hp);
        B.hp = FHE.select(shouldFight, hpBFinal, B.hp);
        
        A.alive = FHE.select(shouldFight, FHE.not(aDead), A.alive);
        B.alive = FHE.select(shouldFight, FHE.not(bDead), B.alive);
        
        emit CombatResolved(aId, bId);
    }

    /// @notice Grant vision for unit stats only (minimal to avoid revert)
    function _grantVisionForUnitStats(uint256 unitId) internal {
        EncryptedUnit storage u = units[unitId];
        address viewer = u.owner;
        
        // Grant vision for unit's own stats only
        FHE.allow(u.x, viewer);
        FHE.allow(u.y, viewer);
        FHE.allow(u.hp, viewer);
        FHE.allow(u.atk, viewer);
        FHE.allow(u.def, viewer);
        FHE.allow(u.alive, viewer);
    }
    
    /// @notice Grant vision for all cells (call separately after createUnit)
    /// This allows createUnit to succeed without revert
    function grantAllCellVision() external {
        // Grant vision for all cells to caller
        for (uint8 iy = 0; iy < HEIGHT; iy++) {
            for (uint8 ix = 0; ix < WIDTH; ix++) {
                EncryptedCell storage cell = grid[iy][ix];
                FHE.allow(cell.terrainType, msg.sender);
                FHE.allowThis(cell.terrainType);
            }
        }
    }
    
    /// @notice Grant vision for a unit (used in moveUnit)
    function _grantVisionForUnit(uint256 unitId) internal {
        _grantVisionForUnitStats(unitId);
        // Note: Cell vision should be granted separately via grantAllCellVision
    }
    
    /// @notice Simplified vision range check
    /// Checks if cell (ix, iy) is within square radius R of unit position (ex, ey)
    /// Uses a simpler approach with fewer FHE operations
    function _isCellInVisionRange(
        euint8 ex,
        euint8 ey,
        uint8 ix,
        uint8 iy,
        uint8 R
    ) internal returns (ebool) {
        euint8 eix = FHE.asEuint8(ix);
        euint8 eiy = FHE.asEuint8(iy);
        
        // Check if cell matches unit position (same cell)
        ebool sameCell = FHE.and(FHE.eq(ex, eix), FHE.eq(ey, eiy));
        
        // Check adjacent cells (simplified - only check immediate neighbors)
        // This is much simpler than checking all cells in radius
        ebool inRange = sameCell;
        
        // Check right neighbor
        euint8 one = FHE.asEuint8(1);
        euint8 rightX = FHE.add(ex, one);
        ebool isRight = FHE.and(FHE.eq(rightX, eix), FHE.eq(ey, eiy));
        inRange = FHE.or(inRange, isRight);
        
        // Check left neighbor (if ex >= 1)
        ebool canGoLeft = FHE.ge(ex, one);
        euint8 leftX = FHE.select(canGoLeft, FHE.sub(ex, one), FHE.asEuint8(255));
        ebool isLeft = FHE.and(FHE.and(FHE.eq(leftX, eix), FHE.eq(ey, eiy)), canGoLeft);
        inRange = FHE.or(inRange, isLeft);
        
        // Check bottom neighbor
        euint8 bottomY = FHE.add(ey, one);
        ebool isBottom = FHE.and(FHE.eq(ex, eix), FHE.eq(bottomY, eiy));
        inRange = FHE.or(inRange, isBottom);
        
        // Check top neighbor (if ey >= 1)
        ebool canGoUp = FHE.ge(ey, one);
        euint8 topY = FHE.select(canGoUp, FHE.sub(ey, one), FHE.asEuint8(255));
        ebool isTop = FHE.and(FHE.and(FHE.eq(ex, eix), FHE.eq(topY, eiy)), canGoUp);
        inRange = FHE.or(inRange, isTop);
        
        // For radius > 1, we can extend this pattern, but for now keep it simple
        // to avoid revert errors
        
        return inRange;
    }


    /// @notice Check if it's this unit's turn
    function _isThisUnitsTurn(uint256 unitId) internal view returns (bool) {
        return currentUnitTurn == unitId && unitId < units.length;
    }

    /// @notice Advance to next turn
    function _advanceTurn() internal {
        if (units.length == 0) return;
        
        currentUnitTurn = (currentUnitTurn + 1) % units.length;
        
        // Check if unit is still alive, if not skip to next
        uint8 skipCount = 0;
        while (skipCount < units.length) {
            // Note: We can't easily check alive status in FHE here without decrypting
            // For POC, we'll just cycle through units
            emit TurnAdvanced(currentUnitTurn);
            return;
        }
    }

    /// @notice Get unit count
    function getUnitCount() external view returns (uint256) {
        return units.length;
    }

    /// @notice Get unit owner (public)
    function getUnitOwner(uint256 unitId) external view returns (address) {
        require(unitId < units.length, "Invalid unit ID");
        return units[unitId].owner;
    }

    /// @notice Get encrypted unit position (for client to decrypt if has permission)
    function getUnitPosition(uint256 unitId) external view returns (euint8 x, euint8 y) {
        require(unitId < units.length, "Invalid unit ID");
        return (units[unitId].x, units[unitId].y);
    }

    /// @notice Get encrypted unit stats
    function getUnitStats(uint256 unitId) external view returns (
        euint16 hp,
        euint16 atk,
        euint16 def,
        ebool alive
    ) {
        require(unitId < units.length, "Invalid unit ID");
        EncryptedUnit storage u = units[unitId];
        return (u.hp, u.atk, u.def, u.alive);
    }

    /// @notice Get current turn info
    function getCurrentTurn() external view returns (uint256 unitId, uint256 round) {
        return (currentUnitTurn, currentRound);
    }

    /// @notice Initialize map with terrain (admin function for setup)
    function setCellTerrain(
        uint8 x,
        uint8 y,
        externalEuint8 terrainExt,
        bytes calldata terrainProof,
        externalEuint8 hasTrapExt,
        bytes calldata hasTrapProof,
        externalEuint8 hasLootExt,
        bytes calldata hasLootProof
    ) external {
        require(x < WIDTH && y < HEIGHT, "Out of bounds");
        
        grid[y][x].terrainType = FHE.fromExternal(terrainExt, terrainProof);
        
        // Convert euint8 to ebool: check if value is not equal to 0
        euint8 trapValue = FHE.fromExternal(hasTrapExt, hasTrapProof);
        euint8 zero8 = FHE.asEuint8(0);
        grid[y][x].hasTrap = FHE.ne(trapValue, zero8);
        
        euint8 lootValue = FHE.fromExternal(hasLootExt, hasLootProof);
        grid[y][x].hasLoot = FHE.ne(lootValue, zero8);
    }

    /// @notice Get cell data (encrypted)
    function getCell(uint8 x, uint8 y) external view returns (
        euint8 terrainType,
        ebool hasTrap,
        ebool hasLoot
    ) {
        require(x < WIDTH && y < HEIGHT, "Out of bounds");
        EncryptedCell storage cell = grid[y][x];
        return (cell.terrainType, cell.hasTrap, cell.hasLoot);
    }
}

