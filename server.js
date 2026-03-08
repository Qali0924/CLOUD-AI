const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static('public'));

app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie!" });

        // Odbieramy parametr 'mode' z frontendu
        const { level, subject, mode } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompts = {
            matematyka: "Jesteś ekspertem matematyki.",
            polski: "Jesteś polonistą.",
            fizyka: "Jesteś fizykiem.",
            inne: "Jesteś nauczycielem."
        };

        let basePrompt = prompts[subject] || prompts.inne;
        let styleInstruction = "";

        // LOGIKA TRYBU ŚCIĄGANIE
        if (mode === 'cheat') {
            styleInstruction = `
            TRYB EKSTREMALNIE SZYBKI: 
            1. Pomiń jakiekolwiek wstępy (np. "Oto rozwiązanie...").
            2. Nie tłumacz teorii, jeśli nie jest to niezbędne do wyniku.
            3. Pisz tylko konkretne obliczenia, wzory i ostateczną odpowiedź.
            4. Bądź maksymalnie zwięzły. Odpowiedz w punktach.`;
        } else {
            styleInstruction = `
            TRYB STANDARDOWY: 
            1. Rozwiąż zadanie krok po kroku.
            2. Wyjaśnij logikę postępowania, aby uczeń mógł się nauczyć.`;
        }

        const finalPrompt = `
        ${basePrompt} Poziom: ${level}. 
        ${styleInstruction}
        ZASADY FORMATOWANIA:
        - Wszystkie wzory matematyczne i zmienne w $ ... $.
        - Wynik końcowy pogrubiony w **$ ... $**.
        - Odpowiadaj wyłącznie po polsku.`;

        const result = await model.generateContent([
            finalPrompt,
            { inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype } }
        ]);

        const response = await result.response;
        res.json({ result: response.text() });

    } catch (error) {
        console.error("Błąd serwera:", error);
        res.status(500).json({ error: "Wystąpił błąd podczas generowania odpowiedzi." });
    }
});

app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `Uczeń otrzymał rozwiązanie: "${context}". Teraz pyta: "${question}". Odpowiedz krótko i jasno. Używaj $...$ do wzorów.`;
        const result = await model.generateContent(prompt);
        res.json({ answer: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serwer śmiga na porcie ${PORT}`));

