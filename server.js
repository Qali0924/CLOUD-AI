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

// --- KONFIGURACJA ---
const geminiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4
].filter(k => k && k.trim() !== "");

let currentGeminiIndex = 0;
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

app.use(express.static('public'));

// --- ROTACJA GEMINI ---
async function tryGemini(prompt, fileData, attempt = 0) {
    if (attempt >= geminiKeys.length) throw new Error("IP Blocked");
    const genAI = new GoogleGenerativeAI(geminiKeys[currentGeminiIndex].trim());
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });

    try {
        console.log(`[Gemini] Próba kluczem ${currentGeminiIndex + 1}...`);
        const result = await model.generateContent([prompt, fileData]);
        return (await result.response).text();
    } catch (error) {
        currentGeminiIndex = (currentGeminiIndex + 1) % geminiKeys.length;
        return tryGemini(prompt, fileData, attempt + 1);
    }
}

// --- GŁÓWNA LOGIKA ---
app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Brak zdjęcia." });

        const { subject, level, mode } = req.body;
        const base64Data = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;

        // Ulepszony PROMPT zapobiegający błędom (Chain of Thought)
        const finalPrompt = `Jesteś ekspertem z dziedziny: ${subject}. Poziom: ${level}.
        TWOJE ZADANIE: Rozwiąż zadanie ze zdjęcia z maksymalną precyzją.
        
        PROCEDURA:
        1. Zidentyfikuj wzory potrzebne do zadania (np. wzory skróconego mnożenia).
        2. Wykonaj obliczenia krok po kroku.
        3. PRZEPROWADŹ AUTOKOREKTĘ: Sprawdź znaki (+/-) oraz czy potęgowanie pierwiastków jest poprawne (np. sqrt(2)^3 = 2*sqrt(2)).
        4. Zsumuj wyrazy podobne.

        FORMATOWANIE:
        - Wszystkie ważne definicje i kroki pogrubiaj: **tekst**.
        - Używaj LaTeX dla matematyki: $równanie$.
        - Wynik końcowy zapisz na końcu w formacie: ### WYNIK: **$odpowiedź$**
        
        Język: Polski. Tryb: ${mode}.`;

        // 1. Gemini
        try {
            const result = await tryGemini(finalPrompt, { 
                inlineData: { data: base64Data, mimeType } 
            });
            return res.json({ result });
        } catch (e) {
            console.log("Gemini padło, wchodzi Llama 4 Scout...");
        }

        // 2. Llama 4 Scout (Z Twojej listy z 2026 r.)
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
                    temperature: 0.1 // Niska temperatura = mniejsza kreatywność, większa precyzja
                });
                return res.json({ result: response.choices[0].message.content });
            } catch (err) {
                res.status(500).json({ error: "Błąd API. Spróbuj za chwilę." });
            }
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const genAI = new GoogleGenerativeAI(geminiKeys[0]);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(`Kontekst: ${context}. Pytanie: ${question}`);
        res.json({ answer: (await result.response).text() });
    } catch (e) { res.status(500).send("Offline"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SPOFY Server Live`));
