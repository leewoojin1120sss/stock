import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'부석증권 | 우리들의 모의투자',description:'우리 이름으로 시작하는 투자. 가상 기업 27개와 ETF, 10분마다 달라지는 공유 시장.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
