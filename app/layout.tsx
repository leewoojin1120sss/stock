import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'부석증권 | 투자 터미널',description:'우리 이름으로 시작하는 투자. 기업 26개와 ETF, 뉴스와 수급이 반영되는 투자 터미널.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
