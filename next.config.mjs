/** @type {import('next').NextConfig} */

// `output: 'standalone'` empaqueta el server para meterlo en una imagen de
// Docker, pero rompe `next start` ("next start does not work with output:
// standalone") y en Vercel no hace falta: Vercel arma su propio bundle.
//
// Por eso se activa SÓLO cuando se va a construir la imagen. El Dockerfile
// pone BUILD_STANDALONE=1; Vercel y el desarrollo local no.
const standalone = process.env.BUILD_STANDALONE === '1'

const nextConfig = {
  ...(standalone ? { output: 'standalone' } : {}),
}

export default nextConfig
