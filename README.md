# Audiobook Player (Touchscreen Interface)

An audio player meant for speech focused audio with touch screen gesture controls. 

---

## 🚀 Features
- Playback speed manipulation in realtime through tempo to prevent pitch alterations
- Rewinding using forward playing chunks
- Adjustable parameters
- leaky integrator to prevent sudden rapid shifts in playback speed
- Touch Screen inputs with two modes to control audio: Circle/Tapping & Swiping 

---

## 📦 How to use:

Method 1: Download all files, open index.html in your browser (double-click)

Method 2: Run a local static server. Download all files and then:
```
# In project folder
py -3 -m http.server 8000
# Then open http://localhost:8000 in browser

```
Method 3: VSCode Live Server Extension.
Ensure Live Server Extenstion is installed.
Open the porject folder and click 'Go Live' on bottom right of VSCode window
