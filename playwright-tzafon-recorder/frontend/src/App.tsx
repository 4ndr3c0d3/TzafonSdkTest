import { Route, Routes } from 'react-router-dom';
import { Box } from '@chakra-ui/react';
import RecorderPage from './pages/RecorderPage';

export default function App() {
  return (
    <Box minH="100vh" bg="#0d1117">
      <Routes>
        <Route path="/" element={<RecorderPage />} />
      </Routes>
    </Box>
  );
}
