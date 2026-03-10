const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk"); // Ta biblioteka obsłuży darmową Llamę

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// --- KLUCZE GEMINI ---
const geminiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4
].filter(k => k && k.trim() !== "");

let currentGeminiIndex = 0;

// --- DARMOWY GROQ (LLAMA 3.3) ---
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

// --- GŁÓWNA OBSŁUGA ---
app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie! 📸" });

        const { subject, level, mode } = req.body;
        const base64Data = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;

        const finalPrompt = `Jesteś ekspertem (${subject}). Poziom: ${level}. 
        Tryb: ${mode === 'cheat' ? 'Same obliczenia i pogrubiony wynik.' : 'Wyjaśnij krok po kroku.'}
        ZASADY: Wzory w $...$, wynik końcowy w **$...$**. Pisz po polsku.`;

        // 1. PRÓBA GEMINI (Darmowe, ale często blokowane IP)
        try {
            const result = await tryGemini(finalPrompt, { 
                inlineData: { data: base64Data, mimeType } 
            });
            return res.json({ result });
        } catch (e) {
            console.log("❌ Gemini zablokowane przez IP Rendera. Odpalam DARMOWEGO Groqa (Plan C)...");
        }

        // 2. KOŁO RATUNKOWE: GROQ (Darmowa Llama 3.3)
// 2. KOŁO RATUNKOWE: GROQ (Llama z obsługą OBRAZÓW)
        if (groq) {
            try {
                const response = await groq.chat.completions.create({
                    model: "llama-3.2-11b-vision-preview", // Model, który WIDZI zdjęcia
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
                console.log("✅ Zadanie rozwiązane przez darmową Llamę Vision!");
                return res.json({ result: response.choices[0].message.content });
            } catch (groqError) {
                console.error("❌ Błąd Groqa:", groqError.message);
                throw new Error("Wszystkie systemy padły. Spróbuj później.");
            }
        }
        } else {
            throw new Error("Brak klucza GROQ_API_KEY w ustawieniach!");
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serwer SPOFY działa z darmowym Groq/Llama!`));

