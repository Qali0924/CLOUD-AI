const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// Zainicjuj API - upewnij się, że w package.json masz najnowszą wersję biblioteki!
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static('public'));

app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie! 📸" });

        const { subject, level, mode } = req.body;

        // POWRÓT DO 2.0 FLASH - używamy pełnej ścieżki i wersji v1beta dla najnowszych modeli
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            apiVersion: "v1beta" 
        });

        const prompts = {
            matematyka: "Jesteś ekspertem matematyki.",
            polski: "Jesteś polonistą.",
            fizyka: "Jesteś fizykiem.",
            inne: "Jesteś wszechstronnym nauczycielem."
        };

        let basePrompt = prompts[subject] || prompts.inne;
        let styleInstruction = (mode === 'cheat') 
            ? "TRYB ŚCIĄGANIE: Zero teorii, same obliczenia i pogrubiony wynik. Bądź ekstremalnie szybki." 
            : "TRYB NAUKA: Wyjaśnij wszystko dokładnie krok po kroku.";

        const finalPrompt = `
        ${basePrompt} Poziom: ${level}.
        ${styleInstruction}
        ZASADY: Wzory w $...$, wynik końcowy w **$...$**. Pisz po polsku.`;

        const result = await model.generateContent([
            finalPrompt,
            { inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype } }
        ]);

        const response = await result.response;
        res.json({ result: response.text() });

    } catch (error) {
        console.error("Błąd Gemini 2.0:", error);
        
        // Jeśli 2.0 wywali limit (429), serwer automatycznie Cię o tym poinformuje
        if (error.status === 429) {
            return res.status(429).json({ error: "Limit Gemini 2.0 wyczerpany. Spróbuj za minutę lub zmień tryb! ⏳" });
        }
        
        res.status(500).json({ error: "Błąd AI: " + error.message });
    }
});

// Pozostała część kodu (/chat i listen) pozostaje bez zmian...
app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });
        const prompt = `Uczeń otrzymał rozwiązanie: "${context}". Teraz pyta: "${question}". Odpowiedz krótko. Wzory w $...$.`;
        const result = await model.generateContent(prompt);
        res.json({ answer: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Gemini 2.0 śmiga na porcie ${PORT}`));
