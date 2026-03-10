const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// --- KONFIGURACJA KLUCZY ---
const geminiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4
].filter(k => k && k.trim() !== "");

let currentGeminiIndex = 0;
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

app.use(express.static('public'));

// --- UNIWERSALNA FUNKCJA ROTACJI GEMINI ---
async function tryGemini(prompt, fileData = null, attempt = 0) {
    if (attempt >= geminiKeys.length) throw new Error("BLOKADA_IP");
    
    const genAI = new GoogleGenerativeAI(geminiKeys[currentGeminiIndex].trim());
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });

    try {
        console.log(`[Gemini] Próba (Klucz ${currentGeminiIndex + 1})...`);
        const result = fileData 
            ? await model.generateContent([prompt, fileData]) 
            : await model.generateContent(prompt);
        return (await result.response).text();
    } catch (error) {
        console.log(`⚠️ Gemini ${currentGeminiIndex + 1} błąd. Przełączam...`);
        currentGeminiIndex = (currentGeminiIndex + 1) % geminiKeys.length;
        return tryGemini(prompt, fileData, attempt + 1);
    }
}

// --- ROZWIĄZYWANIE ZADAŃ (ZDJĘCIA) ---
app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie! 📸" });

        const { subject, level, mode } = req.body;
        const base64Data = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;

        const finalPrompt = `Jesteś nauczycielem (${subject}). Poziom: ${level}. Rozwiąż zadanie ze zdjęcia.
        ZASADY:
        1. Podziel na logiczne **Etapy**.
        2. Używaj $...$ do matematyki. Pogrubiaj ważne fragmenty.
        3. Obliczaj bardzo dokładnie pierwiastki i potęgi.
        ### WYNIK KOŃCOWY: **$...$**`;

        try {
            const result = await tryGemini(finalPrompt, { inlineData: { data: base64Data, mimeType } });
            return res.json({ result });
        } catch (e) {
            console.log("❌ Gemini padło. Uruchamiam Llama 4 Scout...");
            if (groq) {
                const response = await groq.chat.completions.create({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct", 
                    messages: [{ role: "user", content: [{ type: "text", text: finalPrompt }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }] }],
                    temperature: 0.1
                });
                return res.json({ result: response.choices[0].message.content });
            }
            throw new Error("Brak dostępnych systemów AI.");
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- NAPRAWIONY CZAT SPOFY ---
app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const chatPrompt = `Kontekst zadania: ${context}\n\nUżytkownik pyta: ${question}\n\nOdpowiedz krótko i pomocnie jako korepetytor SPOFY. Używaj $...$ do wzorów.`;

        try {
            // Najpierw próbujemy Gemini (z rotacją kluczy)
            const answer = await tryGemini(chatPrompt);
            return res.json({ answer });
        } catch (e) {
            console.log("❌ Czat Gemini zablokowany. Przełączam czat na Groq...");
            // Jeśli Gemini nie działa, używamy szybkiego modelu tekstowego z Groq
            if (groq) {
                const response = await groq.chat.completions.create({
                    model: "llama-3.3-70b-versatile", // Bardzo mądry model tekstowy z Twojej listy
                    messages: [{ role: "user", content: chatPrompt }]
                });
                return res.json({ answer: response.choices[0].message.content });
            }
            throw new Error("Czat jest obecnie niedostępny.");
        }
    } catch (error) {
        console.error("Błąd czatu:", error.message);
        res.status(500).json({ error: "Błąd połączenia z czatem." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serwer SPOFY w pełni sprawny (Solve + Chat)!`));
