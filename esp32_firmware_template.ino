/*
 * ================================================
 *  LKTI ASTRAtech - ESP32 Sensor Firmware
 *  Device: ESP32-COOLANT-001
 *  Server: http://10.20.43.190:3000
 * ================================================
 *  Kirim data ke backend setiap SEND_INTERVAL ms.
 *  Ganti WIFI_SSID, WIFI_PASSWORD, dan pin sensor
 *  sesuai wiring kamu.
 * ================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ============ KONFIGURASI WAJIB ============
const char* WIFI_SSID     = "SSID_WIFI_KAMU";
const char* WIFI_PASSWORD = "PASSWORD_WIFI_KAMU";
const char* SERVER_URL    = "http://10.20.43.190:3000/api/measurements";
const char* PING_URL      = "http://10.20.43.190:3000/api/ping";
const char* DEVICE_ID     = "ESP32-COOLANT-001";
const int   SEND_INTERVAL = 5000; // ms (5 detik)
// ==========================================

// ============ PIN SENSOR ==================
// Sesuaikan dengan wiring kamu
// Analog: GPIO 34, 35, 32, 33 (input only, ADC1)
const int PIN_PH          = 34;   // pH sensor analog out
const int PIN_EC          = 35;   // EC sensor analog out
const int PIN_TURBIDITY   = 32;   // Turbidity sensor analog out
// Temperature: sesuaikan library (DS18B20 / NTC / dll)
// const int PIN_TEMP     = 33;
// ==========================================

unsigned long lastSendTime = 0;

// ============ BACA SENSOR =================
// Ganti fungsi-fungsi ini sesuai sensor aktual kamu.
// Saat ini menggunakan konversi linear sederhana dari ADC.

float readPH() {
  int raw = analogRead(PIN_PH);
  // Contoh kalibrasi: ADC 12-bit (0-4095) -> pH 0-14
  // Sesuaikan slope & offset dengan kalibrasi sensor kamu
  float voltage = raw * (3.3 / 4095.0);
  float ph = 3.5 * voltage + 0.0; // GANTI sesuai kalibrasi
  return ph;
}

float readEC() {
  int raw = analogRead(PIN_EC);
  // Contoh: ADC -> mS/cm
  float voltage = raw * (3.3 / 4095.0);
  float ec = voltage * 2.0; // GANTI sesuai kalibrasi
  return ec;
}

float readTurbidity() {
  int raw = analogRead(PIN_TURBIDITY);
  // Contoh: ADC -> NTU (turbidity biasanya inverse)
  float voltage = raw * (3.3 / 4095.0);
  float ntu = -1120.4 * voltage * voltage + 5742.3 * voltage - 4353.8;
  if (ntu < 0) ntu = 0;
  return ntu;
}

float readTemperature() {
  // Ganti dengan library sensor suhu kamu (DS18B20, dll)
  // Contoh placeholder:
  return 25.0;
}
// ==========================================

void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nFailed to connect WiFi. Restarting...");
    ESP.restart();
  }
}

bool pingServer() {
  HTTPClient http;
  http.begin(PING_URL);
  int code = http.GET();
  http.end();
  return code == 200;
}

void sendSensorData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost, reconnecting...");
    connectWiFi();
    return;
  }

  float ph          = readPH();
  float ec          = readEC();
  float turbidity   = readTurbidity();
  float temperature = readTemperature();

  // Build JSON payload
  StaticJsonDocument<256> doc;
  doc["device_id"]   = DEVICE_ID;
  doc["ph"]          = ph;
  doc["ec"]          = ec;
  doc["turbidity"]   = turbidity;
  doc["temperature"] = temperature;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  int httpCode = http.POST(jsonPayload);

  if (httpCode == 201) {
    Serial.printf("[OK] Data sent -> pH:%.2f EC:%.2f Turb:%.2f Temp:%.2f\n",
                  ph, ec, turbidity, temperature);
  } else {
    Serial.printf("[ERR] HTTP %d - %s\n", httpCode, http.getString().c_str());
  }

  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=== LKTI ASTRAtech ESP32 Sensor ===");
  connectWiFi();

  // Test ping ke server
  Serial.print("Pinging server... ");
  if (pingServer()) {
    Serial.println("OK - Server reachable!");
  } else {
    Serial.println("FAIL - Cek IP server dan firewall!");
  }
}

void loop() {
  unsigned long now = millis();
  if (now - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = now;
    sendSensorData();
  }
}
