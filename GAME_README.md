# Fog-of-War Grid Tactics - FHE Game

Dự án game chiến thuật grid-based với Fog of War sử dụng Fully Homomorphic Encryption (FHE) trên Zama FHEVM.

## 🎮 Tổng quan

Game chiến thuật turn-based trên grid 8x8 với các tính năng:
- **Fog of War**: Mỗi player chỉ nhìn thấy khu vực quanh unit của mình (radius 2)
- **Movement**: Di chuyển unit 1 ô mỗi lượt
- **Combat**: Combat tự động khi 2 unit đối phương gặp nhau
- **Trap & Loot**: Các ô trên map có thể chứa trap (gây damage) hoặc loot (heal)
- **FHE Privacy**: Tất cả thông tin unit (HP, ATK, DEF, vị trí) được mã hóa trên blockchain

## 📁 Cấu trúc

```
contracts/
  └── contracts/
      └── FHEGridGame.sol      # Smart contract chính

frontend/
  └── src/
      ├── App.tsx              # UI component chính
      ├── utils/
      │   ├── fhevm.ts        # FHEVM utilities
      │   └── gameUtils.ts    # Game-specific utilities
      └── deployments/
          └── FHEGridGame.json # Deployment info (auto-generated)
```

## 🚀 Cài đặt và Deploy

### 1. Deploy Contract

```bash
cd contracts
npm install

# Tạo file .env với PRIVATE_KEY của bạn
echo "PRIVATE_KEY=your_private_key_here" > .env

# Deploy lên Sepolia
npx hardhat run scripts/deploy-game.ts --network sepolia
```

Sau khi deploy, file `frontend/src/deployments/FHEGridGame.json` sẽ được tự động tạo với address và ABI.

### 2. Chạy Frontend

```bash
cd frontend
npm install
npm run dev
```

Truy cập `http://localhost:5173` và connect MetaMask wallet.

## 🎯 Cách chơi

### Bước 1: Register Player
- Click "Connect Wallet" để kết nối MetaMask
- Click "Register Player" để đăng ký vào game

### Bước 2: Tạo Unit
- Click vào một ô trên grid để chọn vị trí
- Click "Create Unit at (x, y)" để tạo unit với:
  - HP: 50
  - ATK: 10
  - DEF: 5

### Bước 3: Di chuyển và Chơi
- Khi đến lượt của bạn, unit sẽ có viền xanh lá
- Click vào unit của bạn để chọn
- Click vào ô liền kề (trong phạm vi 1 ô) để di chuyển
- Unit sẽ tự động:
  - Kích hoạt trap/loot nếu có
  - Combat với unit đối phương nếu gặp nhau
  - Cập nhật vision (Fog of War)

## 🔐 FHE Features

### Encrypted Data (FHE)
- Unit position (x, y)
- Unit stats (HP, ATK, DEF)
- Unit alive status
- Map cell terrain
- Trap/Loot flags

### Public Data (Clear)
- Map size (8x8)
- Turn order
- Round number
- Unit owner addresses
- Number of units

### Vision System (Fog of War)
- Mỗi player chỉ decrypt được:
  - Thông tin unit của chính họ
  - Terrain trong radius 2 xung quanh unit của họ
- Các vùng ngoài vision sẽ hiển thị là "?" (unknown)

## 🛠️ Technical Details

### Smart Contract Functions

#### Public Functions
- `registerPlayer()` - Đăng ký player mới
- `createUnit(...)` - Tạo unit mới với encrypted stats
- `moveUnit(unitId, newX, newY)` - Di chuyển unit
- `getCurrentTurn()` - Lấy thông tin turn hiện tại
- `getUnitCount()` - Số lượng units
- `getUnitOwner(unitId)` - Owner của unit
- `getUnitPosition(unitId)` - Vị trí unit (encrypted)
- `getUnitStats(unitId)` - Stats unit (encrypted)
- `getCell(x, y)` - Thông tin cell (encrypted)

#### Internal Logic
- `_resolveCellEffects()` - Xử lý trap/loot
- `_resolveUnitCollisions()` - Xử lý combat
- `_grantVisionForUnit()` - Cấp quyền decrypt vision
- `_advanceTurn()` - Chuyển lượt

### Combat System

Combat diễn ra tự động khi 2 unit khác owner đứng cùng ô:
- Damage = max(ATK - DEF, 1)
- HP = max(HP - Damage, 0)
- Unit chết nếu HP <= 0

### Trap & Loot
- **Trap**: Gây 5 damage khi unit bước vào
- **Loot**: Heal 3 HP khi unit bước vào
- Trap/Loot tự động biến mất sau khi kích hoạt

## 📝 Notes

### POC Limitations
- Map cố định 8x8 (có thể mở rộng sau)
- Vision radius cố định = 2
- Không có terrain modifiers (forest/wall effects)
- Combat đơn giản (1 round)

### Gas Costs
- Create unit: ~ (depends on FHE operations)
- Move unit: ~ (includes trap/loot/collision checks)
- Combat resolution: ~ (FHE damage calculation)

### Future Enhancements
- Multiple terrain types với modifiers
- Skills và abilities
- Replay log system
- Larger maps
- Team-based gameplay

## 🐛 Troubleshooting

### SDK không load
- Kiểm tra CDN script trong `index.html`
- Đảm bảo internet connection để load Zama Relayer SDK

### Decrypt fails
- Đảm bảo unit/position thuộc về bạn
- Kiểm tra ACL permissions đã được grant chưa
- Thử refresh game state

### Transaction fails
- Kiểm tra có đủ Sepolia ETH không
- Kiểm tra đúng network (Sepolia)
- Xem console để biết lỗi chi tiết

## 📚 References

- [Zama FHEVM Documentation](https://docs.zama.ai/fhevm)
- [Template Base](README.md)
- FHEVM Solidity: `@fhevm/solidity ^0.9.1`

