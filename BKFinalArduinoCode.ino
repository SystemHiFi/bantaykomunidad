// Pin Definitions
const int BTN_HOUSE1   = 2;
const int BTN_HOUSE2   = 3;
const int BTN_HOUSE3   = 4;
const int BTN_BARANGAY = 5;

// Dedicated Alert LEDs (Households 1, 2, and 3)
const int LED_HOUSE1   = 6;
const int LED_HOUSE2   = 7;
const int LED_HOUSE3   = 9;

// Master Alarm Buzzer
const int BUZZER_PIN   = 8;

const unsigned long HOLD_TIME = 1000; // Hold duration in milliseconds (1 second)

// Arrays for pin mapping
const int buttonPins[4] = {BTN_HOUSE1, BTN_HOUSE2, BTN_HOUSE3, BTN_BARANGAY};
const int ledPins[3]    = {LED_HOUSE1, LED_HOUSE2, LED_HOUSE3};
const char* sosCodes[4] = {"H1_SOS", "H2_SOS", "H3_SOS", "BH_SOS"};

// State tracking
unsigned long pressStartTime[4] = {0, 0, 0, 0};
bool triggerSent[4]             = {false, false, false, false};
bool alertActive[3]             = {false, false, false}; // Independent state per household

void setup() {
  Serial.begin(9600);
  Serial.setTimeout(50); // Prevents serial read blocking delay

  for (int i = 0; i < 4; i++) {
    pinMode(buttonPins[i], INPUT_PULLUP);
  }

  for (int i = 0; i < 3; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW); // Ensure all start OFF
  }

  pinMode(BUZZER_PIN, OUTPUT);
}

void loop() {
  // 1. Check Physical Button Inputs
  for (int i = 0; i < 4; i++) {
    int buttonState = digitalRead(buttonPins[i]);

    if (buttonState == LOW) {
      if (pressStartTime[i] == 0) {
        pressStartTime[i] = millis(); // Start 1-second hold timer
      } 
      else if ((millis() - pressStartTime[i] >= HOLD_TIME) && !triggerSent[i]) {
        // Send S.O.S alert code to web interface over Serial
        Serial.println(sosCodes[i]); 
        
        // Turn ON the specific LED without clearing existing active LEDs
        if (i < 3) {
          digitalWrite(ledPins[i], HIGH);
          alertActive[i] = true;
        }
        
        // Sound siren audio feedback
        tone(BUZZER_PIN, (i == 3) ? 2200 : 1200, 500); 
        
        triggerSent[i] = true; // Prevent continuous spamming while holding
      }
    } 
    else {
      // Button Released -> Reset timer state (LED stays lit)
      pressStartTime[i] = 0;
      triggerSent[i] = false;
    }
  }

  // 2. Process Commands Sent from Web Portal
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    // Outbound Web Commands to Turn ON Alert Hardware
    if (command == "ON_1" || command == "ON_H1") {
      digitalWrite(LED_HOUSE1, HIGH);
      alertActive[0] = true;
      tone(BUZZER_PIN, 1200, 500);
    }
    else if (command == "ON_2" || command == "ON_H2") {
      digitalWrite(LED_HOUSE2, HIGH);
      alertActive[1] = true;
      tone(BUZZER_PIN, 1200, 500);
    }
    else if (command == "ON_3" || command == "ON_H3") {
      digitalWrite(LED_HOUSE3, HIGH);
      alertActive[2] = true;
      tone(BUZZER_PIN, 1200, 500);
    }

    // Individual Clear Commands
    else if (command == "CLEAR_H1" || command == "CLEAR_1") {
      digitalWrite(LED_HOUSE1, LOW);
      alertActive[0] = false;
    } 
    else if (command == "CLEAR_H2" || command == "CLEAR_2") {
      digitalWrite(LED_HOUSE2, LOW);
      alertActive[1] = false;
    } 
    else if (command == "CLEAR_H3" || command == "CLEAR_3") {
      digitalWrite(LED_HOUSE3, LOW);
      alertActive[2] = false;
    } 
    else if (command == "CLEAR_ACK" || command == "CLEAR_ALL") {
      // Fallback master reset command
      for (int i = 0; i < 3; i++) {
        digitalWrite(ledPins[i], LOW);
        alertActive[i] = false;
      }
    }

    // Mute buzzer only when ALL household alerts are turned off
    if (!alertActive[0] && !alertActive[1] && !alertActive[2]) {
      noTone(BUZZER_PIN);
    }
  }
}
