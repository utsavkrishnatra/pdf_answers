import { db } from '@/db';
import { PineconeClient } from '@/lib/pinecone';
import { SendMessageValidator } from '@/lib/validators/SendMessageValidator';
import { getKindeServerSession } from '@kinde-oss/kinde-auth-nextjs/server';
import { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { PineconeStore } from '@langchain/pinecone';
import { NextRequest } from 'next/server';
import { StreamingTextResponse } from 'ai';
// import { BaseMessageLike } from '@langchain/core/messages';
// import { MessageContent } from '@langchain/core/messages';
// import { AIMessageChunk } from '@langchain/core/messages';
import { KindeUser } from '@kinde-oss/kinde-auth-nextjs/types';

const POST = async (req: NextRequest) => {
  const body = await req.json();

  const { getUser } = getKindeServerSession();
  const user:KindeUser|null = await getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { id: userId } = user;

  if (!userId) return new Response('Unauthorized', { status: 401 });

  const { fileId, message } = SendMessageValidator.parse(body);

  const file = await db.file.findFirst({
    where: {
      id: fileId,
      userId,
    },
  });

  if (!file) return new Response('Not found', { status: 404 });

  await db.message.create({
    data: {
      text: message,
      isUserMessage: true,
      userId,
      fileId,
    },
  });

  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY,
    model: "models/embedding-001"
  });

  const pineconeIndex = PineconeClient.Index('pdfreader');

  const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex,
    namespace: file.id,
  });

  const results = await vectorStore.similaritySearch(message, 4);

  // console.log(JSON.stringify(results));
  

  const prevMessages = await db.message.findMany({
    where: {
      fileId,
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: 6,
  });

  const formattedPrevMessages:any = prevMessages.map((msg) => ({
    role: msg.isUserMessage ? 'user' : 'assistant',
    content: msg.text,
  }));

  const model = new ChatGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY,
    model: "gemini-pro",
    temperature: 0.7,       // Control the randomness of the output
  streaming: true,        // Enable streaming mode
  topK: 40,               // Maintain a high value for diversity
  topP: 0.9,              // Set a moderate value for probability concentration

  
  });


// Convert the prompt template into a single string
const prompt = `
  System message:
  Use the following pieces of context (or previous conversation if needed) to answer the user's question in markdown format.
  If you don't know the answer, just say that you don't know, don't try to make up an answer.
  ----------------
  PREVIOUS CONVERSATION:
  ${formattedPrevMessages.map((msg: any) => msg.content).join('\n')}
  ----------------
  CONTEXT:
  ${results.map((r: any) => r.pageContent).join('\n\n')}
  USER INPUT: ${message}
`;


let collectedResponse = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const streaming = await model.stream(prompt);
        for await (const chunk of streaming) {
          console.log('Chunk received:', chunk);

          const content = chunk.content;
          if (typeof content === 'string') {
            controller.enqueue(content);
            collectedResponse += content;
          } else if (Array.isArray(content)) {
            const text = content.map(item => {
              if ('text' in item && item.type === 'text') {
                return item.text;
              }
              return '';
            }).join('\n');
            controller.enqueue(text);
            collectedResponse += text;
          } else {
            const errorMsg = 'Unknown content type';
            controller.enqueue(errorMsg);
            collectedResponse += errorMsg;
          }
        }

        controller.close();

        // Save the completion response to the database after streaming is complete
        await db.message.create({
          data: {
            text: collectedResponse,
            isUserMessage: false,
            fileId,
            userId,
          },
        });

      } catch (error) {
        console.error('Error occurred during model generation:', error);
        const errorMsg = 'An error occurred while generating the response.';
        controller.enqueue(errorMsg);
        controller.close();
      }
    }
  });

  return new StreamingTextResponse(stream);

};

export { POST };