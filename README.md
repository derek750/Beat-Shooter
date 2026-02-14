# Piano-Tiles

# ESP32 controller setup

This project can use an **ESP32-WROOM32** (or compatible) board as a physical controller. The board connects over USB and sends button states to the ESP32 server.

## 1. Plug in the ESP32

1. Connect the ESP32 to your computer with a **USB cable** (micro-USB or USB-C depending on your board).
2. Ensure the board is powered (many boards get power from USB).
3. Install the correct **USB-to-serial driver** if your OS doesn’t recognize the device:
   - **macOS:** Many ESP32 boards use CP210x or CH340. Install [Silicon Labs CP210x](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers) or a CH340 driver if your board uses it.
   - **Windows:** Windows may auto-install; otherwise install the same CP210x or CH340 driver from the manufacturer.
   - **Linux:** Usually works with `cp210x` or `ch341` kernel modules. You may need to add your user to the `dialout` group: `sudo usermod -a -G dialout $USER` (then log out and back in).

## 2. Find the serial port

The ESP32 appears as a serial (COM) port. Use one of the following.

### Option A: Use the ESP32 server (recommended)

1. Start the ESP32 server:
   ```bash
   python esp32_server.py
   ```
   Or: `uvicorn esp32_server:app --host 0.0.0.0 --port 8001`

2. List available ports:
   ```bash
   curl http://localhost:8001/esp32/ports
   ```
   Or open `http://localhost:8001/esp32/ports` in a browser.

3. In the response, use the `device` value for your ESP32 (e.g. `COM3`, `/dev/cu.usbserial-0001`, `/dev/ttyUSB0`).

### Option B: Check from the command line

- **macOS:**  
  `ls /dev/cu.usb*` or `ls /dev/tty.usb*`  
  Typical: `/dev/cu.usbserial-XXXX` or `/dev/cu.SLAB_USBtoUART`.

- **Windows:**  
  Open **Device Manager** → **Ports (COM & LPT)**. Look for “USB Serial Port (COM*n*)” or “CP210x / CH340” and note the COM number (e.g. `COM3`).

- **Linux:**  
  `ls /dev/ttyUSB*` or `ls /dev/ttyACM*`  
  Typical: `/dev/ttyUSB0` or `/dev/ttyACM0`.

## 3. Connect the server to the ESP32

1. With the ESP32 server running, call the connect endpoint with the port you found:

   ```bash
   curl -X POST http://localhost:8001/esp32/connect \
     -H "Content-Type: application/json" \
     -d '{"port": "/dev/cu.usbserial-0001", "baud_rate": 115200}'
   ```

   Replace `"/dev/cu.usbserial-0001"` with your actual port (e.g. `"COM3"` on Windows).

2. Default baud rate is **115200**. Use the same baud rate in your ESP32 firmware (e.g. `Serial.begin(115200)`).

## 4. Check the connection

- **Status:**  
  `curl http://localhost:8001/esp32/status`  
  Expect `"connected": true` and the correct `"port"` when connected.

- **Button data:**  
  `curl http://localhost:8001/esp32/buttons`  
  Returns the current button state, e.g. `{"buttons": [0,1,0,0], "count": 4}`.

- **Health:**  
  `curl http://localhost:8001/health`  
  Expect `{"status": "healthy"}`.

## 5. If the port doesn’t appear or connection fails

- Unplug and replug the USB cable.
- Try another USB port or cable (some cables are charge-only).
- Confirm the correct driver is installed (see step 1).
- On Linux, confirm your user is in the `dialout` group and that no other program (e.g. Serial Monitor) has the port open.
- Close any Serial Monitor or Arduino IDE serial window that might be using the same port.
