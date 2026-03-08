const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// --- KONFIGURACJA KLUCZY GEMINI ---
const geminiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4
].filter(k => k && k.trim() !== "");

let currentGeminiIndex = 0;

// --- KONFIGURACJA GROK (xAI) ---
const grok = process.env.XAI_API_KEY ? new OpenAI({ 
    apiKey: process.env.XAI_API_KEY, 
    baseURL: "https://api.x.ai/v1" 
}) : null;

app.use(express.static('public'));

// --- FUNKCJA ROTACJI GEMINI ---
async function tryGemini(prompt, fileData, attempt = 0) {
    if (attempt >= geminiKeys.length) throw new Error("Wszystkie Gemini zajęte.");
    
    const genAI = new GoogleGenerativeAI(geminiKeys[currentGeminiIndex].trim());
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });

    try {
        console.log(`[Gemini] Próba kluczem nr ${currentGeminiIndex + 1}...`);
        const result = await model.generateContent([prompt, fileData]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        if (error.status === 429 || error.message.includes('429')) {
            console.log(`⚠️ Gemini ${currentGeminiIndex + 1} Limit. Skok na następny...`);
            currentGeminiIndex = (currentGeminiIndex + 1) % geminiKeys.length;
            return tryGemini(prompt, fileData, attempt + 1);
        }
        throw error;
    }
}

// --- GŁÓWNA OBSŁUGA ZADANIA ---
app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie! 📸" });

        const { subject, level, mode } = req.body;
        const base64Data = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;

        const finalPrompt = `Jesteś ekspertem (${subject}). Poziom: ${level}. 
        Tryb: ${mode === 'cheat' ? 'Same obliczenia i pogrubiony wynik.' : 'Wyjaśnij krok po kroku.'}
        ZASADY: Wzory matematyczne w $...$, wynik końcowy zawsze w **$...$**. Pisz po polsku.`;

        // 1. NAJPIERW GEMINI (Próba wszystkich 4 kluczy)
        try {
            const result = await tryGemini(finalPrompt, { 
                inlineData: { data: base64Data, mimeType } 
            });
            return res.json({ result });
        } catch (e) {
            console.log("❌ Wszystkie Gemini padły. Odpalam Plan B: GROK-4...");
        }

        // 2. JEŚLI GEMINI PADŁO -> UŻYJ GROK-4
        if (grok) {
            try {
                const response = await grok.chat.completions.create({
                    model: "grok-4-latest", // Najnowszy model z Twojej dokumentacji
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: finalPrompt },
                                {
                                    type: "image_url",
                                    image_url: { url: `data:${mimeType};base64,${base64Data}` }
                                }
                            ]
                        }
                    ]
                });
                console.log("✅ Zadanie rozwiązane przez Groka!");
                return res.json({ result: response.choices[0].message.content });
            } catch (grokError) {
                console.error("❌ Błąd Groka:", grokError.message);
                throw new Error("Grok zwrócił błąd: " + grokError.message);
            }
        } else {
            throw new Error("Brak dostępnych systemów AI (Gemini padło, a Grok nie jest skonfigurowany).");
        }

    } catch (error) {
        console.error("Błąd serwera:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const genAI = new GoogleGenerativeAI(geminiKeys[currentGeminiIndex]);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(`Kontekst: ${context}. Pytanie: ${question}`);
        res.json({ answer: (await result.response).text() });
    } catch (error) {
        res.status(500).json({ error: "Czat tymczasowo niedostępny." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serwer SPOFY Multi-AI aktywny!`);
    console.log(`Gemini: ${geminiKeys.length} klucze | Grok: ${grok ? "Gotowy" : "Brak klucza"}`);
});
