const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Ładowanie dotenv tylko w trybie deweloperskim
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json()); // Ważne dla obsługi czatu!
const upload = multer({ storage: multer.memoryStorage() });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static('public'));

// GŁÓWNE ROZWIĄZYWANIE ZADANIA
app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie!" });

        const { level, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompts = {
            matematyka: "Jesteś nauczycielem matematyki. Rozwiąż zadanie krok po kroku.",
            polski: "Jesteś polonistą. Przeanalizuj tekst, sprawdź błędy lub zinterpretuj utwór.",
            fizyka: "Jesteś fizykiem. Wypisz dane, szukane, wzory i obliczenia z jednostkami.",
            inne: "Jesteś wszechstronnym nauczycielem. Rozwiąż zadanie w sposób edukacyjny."
        };

        const basePrompt = prompts[subject] || prompts.inne;
        const finalPrompt = `${basePrompt} Poziom: ${level}. 
        ZASADY: 1. Wzory w znakach $...$. 2. Najważniejsze wyniki i wynik końcowy w **$ ... $**. 3. Pisz po polsku.`;

        const result = await model.generateContent([
            finalPrompt,
            { inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype } }
        ]);

        const response = await result.response;
        res.json({ result: response.text() });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// INTERAKTYWNY CZAT
app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `Uczeń otrzymał rozwiązanie: "${context}". Teraz pyta: "${question}". 
        Odpowiedz krótko i jasno jako pomocny nauczyciel. Używaj $...$ do matematyki.`;

        const result = await model.generateContent(prompt);
        res.json({ answer: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 CloudSolve śmiga na porcie ${PORT}`));
