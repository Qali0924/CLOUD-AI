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

// --- KONFIGURACJA GROQ ---
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
        if (error.status === 429 || error.message.includes('429')) {
            console.log(`⚠️ Gemini ${currentGeminiIndex + 1} Limit/IP Block. Skok dalej...`);
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

        // 1. PRÓBA GEMINI
        try {
            const result = await tryGemini(finalPrompt, { 
                inlineData: { data: base64Data, mimeType } 
            });
            console.log("✅ Rozwiązane przez Gemini!");
            return res.json({ result });
        } catch (e) {
            console.log("❌ Gemini padło. Odpalam DARMOWY Groq Vision (Llama 3.2)...");
        }

        // 2. PLAN B: GROQ (Używamy NAZW, które Groq AKCEPTUJE)
        if (groq) {
            try {
                // To jest identyfikator modelu, który Groq faktycznie ma w systemie:
                console.log("🚀 Próba: llama-3.2-11b-vision-preview...");
                const response = await groq.chat.completions.create({
                    model: "llama-3.2-11b-vision-preview", 
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
                console.log("✅ Rozwiązane przez Groq (Llama 3.2)!");
                return res.json({ result: response.choices[0].message.content });
            } catch (groqError) {
                console.log("⚠️ Llama 11b błąd 404, próbuję model LLaVA...");
                try {
                    // LLava to stary, pewny model Vision na Groq
                    const responseLlava = await groq.chat.completions.create({
                        model: "llava-v1.5-7b-4096-preview",
                        messages: [
                            {
                                role: "user",
                                content: [
                                    { type: "text", text: finalPrompt },
                                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }
                                ]
                            }
                        ]
                    });
                    console.log("✅ Rozwiązane przez LLaVA!");
                    return res.json({ result: responseLlava.choices[0].message.content });
                } catch (err2) {
                    console.error("❌ Wszystkie nazwy zawiodły:", err2.message);
                    throw new Error("Groq nie rozpoznał żadnego modelu Vision. Sprawdź console.groq.com/docs/models");
                }
            }
        } else {
            throw new Error("Brak klucza GROQ_API_KEY.");
        }

    } catch (error) {
        console.error("Błąd ogólny:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Reszta kodu (chat, port) zostaje bez zmian
app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const genAI = new GoogleGenerativeAI(geminiKeys[0] || "");
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(`Pytanie: ${question}. Kontekst: ${context}`);
        res.json({ answer: (await result.response).text() });
    } catch (error) {
        res.status(500).json({ error: "Czat offline." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serwer SPOFY aktywny!`));
