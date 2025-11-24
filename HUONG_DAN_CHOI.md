# 🎮 Hướng dẫn chơi Fog-of-War Grid Tactics

## 📋 Chuẩn bị

1. **MetaMask Wallet** với Sepolia ETH
   - Cài đặt MetaMask extension
   - Thêm network Sepolia:
     - Network Name: Sepolia Test Network
     - RPC URL: https://ethereum-sepolia-rpc.publicnode.com
     - Chain ID: 11155111
     - Currency Symbol: ETH

2. **Sepolia ETH** (testnet - miễn phí)
   - Lấy tại: https://sepoliafaucet.com/ hoặc faucet khác

## 🚀 Bắt đầu chơi

### Bước 1: Mở ứng dụng

1. Chạy frontend:
   ```bash
   cd frontend
   npm run dev
   ```

2. Mở browser: `http://localhost:5173`

### Bước 2: Kết nối Wallet

1. Click button **"Connect Wallet"**
2. Chọn MetaMask
3. Chọn account có Sepolia ETH
4. Chấp nhận connection request

### Bước 3: Đăng ký Player

1. Sau khi kết nối, click **"Register Player"**
2. Chấp nhận transaction trong MetaMask
3. Đợi transaction confirm

### Bước 4: Tạo Unit đầu tiên

1. **Click vào một ô trên grid** (ví dụ: ô (0,0))
   - Grid là bảng 8x8
   - Ô được chọn sẽ có viền xanh lá

2. Click button **"Create Unit at (x, y)"**
   - Unit sẽ được tạo với:
     - HP: 50
     - ATK: 10
     - DEF: 5

3. Chấp nhận transaction trong MetaMask

4. Đợi transaction confirm

### Bước 5: Xem Unit của bạn

1. Click **"🔐 Load & Decrypt Vision"** để decrypt và xem dữ liệu
   - **LƯU Ý:** Lần đầu sẽ yêu cầu signature để decrypt
   - Đây là bình thường và an toàn (chỉ để xem dữ liệu của bạn)

2. Sau khi decrypt, bạn sẽ thấy:
   - **Units list:** Unit của bạn với HP, ATK, DEF
   - **Grid:** Vị trí unit của bạn (số unit ID)

### Bước 6: Di chuyển Unit

1. **Chờ đến lượt bạn:**
   - Xem "Current Turn" - nếu là unit ID của bạn
   - Unit của bạn sẽ có **viền xanh lá** trên grid

2. **Chọn unit:**
   - Click vào unit card trong "Units" section
   - Hoặc unit sẽ tự động được highlight khi đến lượt

3. **Di chuyển:**
   - Click vào ô **liền kề** (trong phạm vi 1 ô)
   - Có thể di chuyển: lên, xuống, trái, phải, hoặc chéo
   - **KHÔNG** thể di chuyển quá 1 ô một lần

4. Transaction sẽ tự động được tạo:
   - Unit di chuyển
   - Kiểm tra trap/loot trên ô đó
   - Nếu gặp unit đối phương → Combat tự động

### Bước 7: Hiểu Fog of War

- **Vùng nhìn thấy (Vision):**
  - Bạn chỉ thấy được các ô trong **bán kính 2** xung quanh unit của mình
  - Ô có thể nhìn thấy: hiển thị terrain (plain/forest/wall)
  - Ô không nhìn thấy: hiển thị "?" (đen)

- **Decrypt Vision:**
  - Click "🔐 Load & Decrypt Vision" sau mỗi lần di chuyển
  - Để cập nhật vùng nhìn thấy mới

## 🎯 Các tính năng

### ⚠️ Trap (Bẫy)
- Khi unit bước vào ô có trap
- Tự động gây 5 damage
- Trap biến mất sau khi kích hoạt

### 💰 Loot (Vật phẩm)
- Khi unit bước vào ô có loot
- Tự động heal 3 HP
- Loot biến mất sau khi lấy

### ⚔️ Combat (Chiến đấu)
- Tự động xảy ra khi 2 unit khác owner đứng cùng ô
- Damage = max(ATK - DEF, 1)
- Unit chết nếu HP <= 0

### 🔄 Turn System
- Mỗi unit di chuyển một lượt
- Tự động chuyển lượt sau mỗi move
- Vòng lặp qua tất cả units

## 💡 Tips

1. **Di chuyển cẩn thận:**
   - Tránh trap (⚠️) nếu HP thấp
   - Tìm loot (💰) để heal

2. **Fog of War:**
   - Di chuyển từ từ để mở map
   - Không thể nhìn thấy unit đối phương từ xa

3. **Combat:**
   - ATK cao hơn DEF = nhiều damage
   - Cân nhắc khi tấn công unit có DEF cao

4. **Refresh thường xuyên:**
   - Click "Refresh Game State" để cập nhật thông tin
   - Click "🔐 Load & Decrypt Vision" để xem dữ liệu mới

## 🐛 Troubleshooting

### Không thấy unit sau khi tạo
- Click "Refresh Game State"
- Sau đó click "🔐 Load & Decrypt Vision"

### Không di chuyển được
- Kiểm tra xem có đến lượt bạn chưa
- Đảm bảo chỉ di chuyển 1 ô
- Kiểm tra có đủ Sepolia ETH để trả gas

### Signature request xuất hiện nhiều
- Bình thường khi decrypt dữ liệu
- Có thể click "Cancel" nếu chưa muốn decrypt
- Chỉ cần decrypt khi muốn xem thông tin chi tiết

### Transaction fail
- Kiểm tra có đủ Sepolia ETH
- Kiểm tra network (phải là Sepolia)
- Xem error message trong console

## 🎉 Chúc bạn chơi vui!

Game này là POC (Proof of Concept), có thể có một số hạn chế. Hãy thử nghiệm và báo lại nếu gặp vấn đề!

