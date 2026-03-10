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

// --- LOGIKA ROTACJI GEMINI ---
async function tryGemini(prompt, fileData, attempt = 0) {
    if (attempt >= geminiKeys.length) throw new Error("Wszystkie klucze Gemini zablokowane.");
    
    const genAI = new GoogleGenerativeAI(geminiKeys[currentGeminiIndex].trim());
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });

    try {
        console.log(`[Gemini] Próba kluczem ${currentGeminiIndex + 1}...`);
        const result = await model.generateContent([prompt, fileData]);
        return (await result.response).text();
    } catch (error) {
        console.log(`⚠️ Gemini ${currentGeminiIndex + 1} błąd. Rotacja...`);
        currentGeminiIndex = (currentGeminiIndex + 1) % geminiKeys.length;
        return tryGemini(prompt, fileData, attempt + 1);
    }
}

// --- GŁÓWNA OBSŁUGA ZADANIA ---
app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie! 📸" });

        const { subject, level, mode } = req.body;
        const base64Data = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;

        // Skoncentrowany Prompt - usuwa "myślenie na głos" modelu
        const finalPrompt = `Jesteś ekspertem (${subject}). Poziom: ${level}.
        ROZWIĄŻ ZADANIE ZE ZDJĘCIA.
        
        WYMAGANIA:
        - Nie pisz "Krok 1: Zidentyfikuj wzory" ani innych opisów swoich procesów myślowych.
        - Podawaj tylko czyste etapy obliczeń.
        - Każdy etap obliczeń pogrubiaj dla czytelności.
        - Sprawdź dwukrotnie znaki (+/-) i potęgi pierwiastków przed wypisaniem wyniku (wykonaj to w pamięci).
        - Używaj $...$ dla wzorów i obliczeń.
        
        FORMAT ODPOWIEDZI:
        1. **Zastosowane wzory:** (krótka lista)
        2. **Obliczenia:** (czytelne etapy)
        3. ### WYNIK: **$...$**

        Język: Polski. Tryb: ${mode === 'cheat' ? 'Same obliczenia i pogrubiony wynik.' : 'Wyjaśnij zwięźle.'}`;

        // 1. Próba Gemini
        try {
            const result = await tryGemini(finalPrompt, { 
                inlineData: { data: base64Data, mimeType } 
            });
            return res.json({ result });
        } catch (e) {
            console.log("❌ Gemini padło. Odpalam Llama 4 Scout...");
        }

        // 2. Plan B: Groq (Llama 4 Scout)
        if (groq) {
            try {
                const response = await groq.chat.completions.create({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct", 
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: finalPrompt },
                                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }
                            ]
                        }
                    ],
                    temperature: 0.1 // Maksymalna precyzja, zero "kreatywności"
                });
                return res.json({ result: response.choices[0].message.content });
            } catch (err) {
                console.error("Błąd Groq:", err.message);
                res.status(500).json({ error: "Systemy AI przeciążone. Spróbuj za chwilę." });
            }
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obsługa Czatu SPOFY
app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const genAI = new GoogleGenerativeAI(geminiKeys[0]);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(`Kontekst: ${context}. Pytanie: ${question}`);
        res.json({ answer: (await result.response).text() });
    } catch (e) {
        res.status(500).send("Czat offline.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SPOFY Live na porcie ${PORT}`));
