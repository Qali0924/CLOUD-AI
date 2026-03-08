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

// --- KONFIGURACJA KLUCZY ---
const geminiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4
].filter(k => k && k.trim() !== "");

let currentGeminiIndex = 0;

// Inicjalizacja OpenAI i Groka (używamy tej samej biblioteki, bo są kompatybilne)
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const grok = process.env.XAI_API_KEY ? new OpenAI({ 
    apiKey: process.env.XAI_API_KEY, 
    baseURL: "https://api.x.ai/v1" 
}) : null;

app.use(express.static('public'));

// --- LOGIKA ROTACJI GEMINI ---
async function tryGemini(prompt, fileData, attempt = 0) {
    if (attempt >= geminiKeys.length) throw new Error("Wszystkie Gemini padły.");
    
    const genAI = new GoogleGenerativeAI(geminiKeys[currentGeminiIndex].trim());
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });

    try {
        console.log(`[Gemini] Próba kluczem nr ${currentGeminiIndex + 1}...`);
        const result = await model.generateContent([prompt, fileData]);
        return (await result.response).text();
    } catch (error) {
        if (error.status === 429) {
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
        ZASADY: Wzory w $...$, wynik końcowy w **$...$**. Pisz po polsku.`;

        // 1. NAJPIERW GEMINI (Darmowe)
        try {
            const result = await tryGemini(finalPrompt, { inlineData: { data: base64Data, mimeType } });
            return res.json({ result });
        } catch (e) {
            console.log("❌ Gemini padło. Próba OpenAI...");
        }

        // 2. POTEM OPENAI (Płatne, Plan B)
        if (openai) {
            try {
                const response = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{ role: "user", content: [{ type: "text", text: finalPrompt }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }] }]
                });
                return res.json({ result: response.choices[0].message.content });
            } catch (e) {
                console.log("❌ OpenAI padło. Próba Grok...");
            }
        }

        // 3. NA KOŃCU GROK (Płatne, Plan C)
        if (grok) {
            try {
                const response = await grok.chat.completions.create({
                    model: "grok-2-vision-1212",
                    messages: [{ role: "user", content: [{ type: "text", text: finalPrompt }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }] }]
                });
                return res.json({ result: response.choices[0].message.content });
            } catch (e) {
                console.error("❌ Grok też zawiódł:", e.message);
            }
        }

        throw new Error("Wszystkie systemy AI (Gemini, OpenAI, Grok) są obecnie niedostępne. 🛑");

    } catch (error) {
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
        res.status(500).json({ error: "Czat tymczasowo wyłączony." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 System Multi-AI (Gemini/OpenAI/Grok) działa!`));
