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

// --- KONFIGURACJA KLUCZY GEMINI ---
const geminiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4
].filter(k => k && k.trim() !== "");

let currentGeminiIndex = 0;

// --- KONFIGURACJA GROQ (Używamy Llama 4 Scout) ---
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

app.use(express.static('public'));

// --- LOGIKA ROTACJI GEMINI ---
async function tryGemini(prompt, fileData, attempt = 0) {
    if (attempt >= geminiKeys.length) throw new Error("Blokada IP Google na Renderze.");
    
    const genAI = new GoogleGenerativeAI(geminiKeys[currentGeminiIndex].trim());
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });

    try {
        console.log(`[Gemini] Próba kluczem nr ${currentGeminiIndex + 1}...`);
        const result = await model.generateContent([prompt, fileData]);
        return (await result.response).text();
    } catch (error) {
        if (error.status === 429 || error.message.includes('429') || error.message.includes('403')) {
            console.log(`⚠️ Gemini ${currentGeminiIndex + 1} Limit/Blokada. Skok dalej...`);
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
        ZASADY: Wzory w $...$, wynik końcowy w **$...$**. Odpowiadaj wyłącznie po polsku.`;

        // 1. PRÓBA GEMINI (Klucze 1-4)
        try {
            const result = await tryGemini(finalPrompt, { 
                inlineData: { data: base64Data, mimeType } 
            });
            console.log("✅ Rozwiązane przez Gemini!");
            return res.json({ result });
        } catch (e) {
            console.log("❌ Gemini padło (Blokada IP). Odpalam Llama 4 Scout (Plan B)...");
        }

        // 2. PLAN B: GROQ (Używamy Llama 4 Scout z Twojej listy)
        if (groq) {
            try {
                console.log("🚀 Próba: meta-llama/llama-4-scout-17b-16e-instruct...");
                const response = await groq.chat.completions.create({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct", 
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
                console.log("✅ Rozwiązane przez Llama 4 Scout!");
                return res.json({ result: response.choices[0].message.content });
            } catch (groqError) {
                console.error("❌ Błąd Groqa:", groqError.message);
                throw new Error("Wszystkie systemy (Gemini i Llama 4) są obecnie niedostępne.");
            }
        } else {
            throw new Error("Brak klucza GROQ_API_KEY.");
        }

    } catch (error) {
        console.error("Błąd ogólny:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Obsługa Czatu (SPOFY)
app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const genAI = new GoogleGenerativeAI(geminiKeys[0] || "");
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(`Pytanie: ${question}. Kontekst: ${context}`);
        res.json({ answer: (await result.response).text() });
    } catch (error) {
        res.status(500).json({ error: "Czat SPOFY jest obecnie offline." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Serwer SPOFY Multi-AI aktywny!`);
    console.log(`Dostępne systemy: Gemini (4 klucze), Llama 4 Scout`);
});

