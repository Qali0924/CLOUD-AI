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

// --- ROTACJA GEMINI ---
async function tryGemini(prompt, fileData = null, attempt = 0) {
    if (attempt >= geminiKeys.length) throw new Error("BLOKADA_IP");
    const genAI = new GoogleGenerativeAI(geminiKeys[currentGeminiIndex].trim());
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });
    try {
        console.log(`[Gemini] Próba (Klucz ${currentGeminiIndex + 1})...`);
        const result = fileData ? await model.generateContent([prompt, fileData]) : await model.generateContent(prompt);
        return (await result.response).text();
    } catch (error) {
        currentGeminiIndex = (currentGeminiIndex + 1) % geminiKeys.length;
        return tryGemini(prompt, fileData, attempt + 1);
    }
}

// --- GŁÓWNA OBSŁUGA ZADANIA ---
app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie!" });

        const { subject, level } = req.body;
        const base64Data = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;

        // Skrajnie konkretny prompt: tylko obliczenia
        const finalPrompt = `Ekspert: ${subject}. Poziom: ${level}.
        ZADANIE: Rozwiąż bez zbędnych słów.
        
        WYMAGANIA:
        1. ZERO wstępów i opisów kroków typu "Teraz dodajemy".
        2. Same czyste obliczenia matematyczne w kolejności logicznej.
        3. Używaj $...$ do wzorów.
        4. ZAZNACZANIE: Najważniejsze wyniki pośrednie i kluczowe przejścia zapisuj w formacie: \`[WAŻNE: wynik]\`.
        5. Sprawdź dwukrotnie potęgi pierwiastków w pamięci.

        STRUKTURA:
        - Obliczenia etap po etapie.
        - ### WYNIK KOŃCOWY: **$...$**`;

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
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- CZAT SPOFY ---
app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const chatPrompt = `Kontekst: ${context}\nUżytkownik: ${question}\nOdpowiedz krótko (korepetytor SPOFY).`;
        try {
            const answer = await tryGemini(chatPrompt);
            return res.json({ answer });
        } catch (e) {
            if (groq) {
                const response = await groq.chat.completions.create({
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "user", content: chatPrompt }]
                });
                return res.json({ answer: response.choices[0].message.content });
            }
            throw new Error("Offline");
        }
    } catch (error) {
        res.status(500).json({ error: "Czat offline." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SPOFY LIVE (Quick Solve + Chat)`));
