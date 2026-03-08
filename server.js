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

// --- KONFIGURACJA AI ---

// 1. Gemini - Twoje 4 klucze z 2 kont
const apiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4
].filter(key => key && key.trim() !== "");

let currentKeyIndex = 0;

// 2. OpenAI - Koło ratunkowe
const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY 
});

app.use(express.static('public'));

// --- LOGIKA ROTACJI GEMINI ---
async function generateWithGemini(prompt, fileData, attempt = 0) {
    if (apiKeys.length === 0) throw new Error("Brak kluczy Gemini.");
    if (attempt >= apiKeys.length) throw new Error("Wszystkie klucze Gemini przeciążone.");

    const genAI = new GoogleGenerativeAI(apiKeys[currentKeyIndex].trim());
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash", 
        apiVersion: "v1beta" 
    });

    try {
        console.log(`[Gemini] Próba kluczem nr ${currentKeyIndex + 1}...`);
        const result = await model.generateContent([prompt, fileData]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        if (error.status === 429 || error.message.includes('429')) {
            console.log(`⚠️ Gemini Key ${currentKeyIndex + 1} zajęty. Rotacja...`);
            currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
            return generateWithGemini(prompt, fileData, attempt + 1);
        }
        throw error;
    }
}

// --- GŁÓWNA OBSŁUGA ZADANIA (FAILOVER) ---
app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie! 📸" });

        const { subject, level, mode } = req.body;
        const base64Data = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;

        const prompts = {
            matematyka: "Jesteś ekspertem matematyki.",
            polski: "Jesteś polonistą.",
            fizyka: "Jesteś fizykiem.",
            inne: "Jesteś wszechstronnym nauczycielem."
        };

        const finalPrompt = `
            ${prompts[subject] || prompts.inne} Poziom: ${level}.
            Tryb: ${mode === 'cheat' ? 'Same obliczenia i pogrubiony wynik.' : 'Wyjaśnij krok po kroku.'}
            ZASADY: Wzory w $...$, wynik w **$...$**. Pisz po polsku.`;

        try {
            // NAJPIERW: Próbujemy Gemini (Twoje 4 klucze)
            const result = await generateWithGemini(finalPrompt, {
                inlineData: { data: base64Data, mimeType }
            });
            res.json({ result });

        } catch (geminiError) {
            // JEŚLI GEMINI PADŁO: Odpalamy OpenAI (GPT-4o)
            console.log("❌ Wszystkie Gemini padły. Przełączam na OpenAI (Plan B)...");

            if (!process.env.OPENAI_API_KEY) {
                throw new Error("Gemini nie działa, a brakuje klucza OPENAI_API_KEY!");
            }

            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: finalPrompt },
                            {
                                type: "image_url",
                                image_url: { url: `data:${mimeType};base64,${base64Data}` }
                            }
                        ],
                    },
                ],
            });
            
            res.json({ result: response.choices[0].message.content });
        }

    } catch (error) {
        console.error("Błąd krytyczny:", error.message);
        res.status(500).json({ error: "Oba systemy AI są obecnie zajęte. Spróbuj za chwilę! ⏳" });
    }
});

// --- CZAT (RÓWNIEŻ Z FAILOVEREM) ---
app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const prompt = `Kontekst: ${context}. Pytanie: ${question}. Krótka odpowiedź.`;
        
        const genAI = new GoogleGenerativeAI(apiKeys[currentKeyIndex]);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });
        const result = await model.generateContent(prompt);
        res.json({ answer: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: "Czat tymczasowo niedostępny." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 System Multi-AI aktywny na porcie ${PORT}`);
    console.log(`Załadowane klucze Gemini: ${apiKeys.length}`);
    console.log(`Plan B (OpenAI): ${process.env.OPENAI_API_KEY ? "AKTYWNY" : "BRAK KLUCZA"}`);
});
