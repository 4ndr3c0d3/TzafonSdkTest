import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Icon,
  Input,
  Stack,
  Tag,
  Text,
  Textarea,
  useToast,
} from '@chakra-ui/react';
import { useRef, useState } from 'react';
import { FiCopy, FiLink, FiPlay, FiStopCircle } from 'react-icons/fi';

type SessionState = { id: string; viewport: { width: number; height: number } } | null;

const API_BASE = import.meta.env.VITE_API_BASE || '';

async function postJson<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.error || res.statusText || 'Request failed';
    throw new Error(msg);
  }
  return data as T;
}

export default function RecorderPage() {
  const [url, setUrl] = useState('https://www.google.com/');
  const [session, setSession] = useState<SessionState>(null);
  const [image, setImage] = useState('');
  const [tzafon, setTzafon] = useState<string[]>([]);
  const [info, setInfo] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [lastEvent, setLastEvent] = useState('');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const toast = useToast();

  const startSession = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setInfo('Starting Playwright + opening page...');
    try {
      const data = await postJson<{ id: string; viewport: any; image: string; tzafon: string[] }>('/api/session', { url });
      setSession({ id: data.id, viewport: data.viewport });
      setImage(data.image);
      setTzafon(data.tzafon || []);
      setInfo('Session ready. Click/scroll/type on the preview.');
      setLastEvent('');
      setTimeout(() => overlayRef.current?.focus(), 50);
    } catch (err: any) {
      setInfo(err?.message || 'Failed to start session');
      toast({ status: 'error', title: 'Start failed', description: err?.message || 'Unknown error' });
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async () => {
    if (!session) return;
    setBusy(true);
    try { await postJson(`/api/session/${session.id}/close`, {}); } catch {}
    setSession(null);
    setImage('');
    setTzafon([]);
    setInfo('Session closed');
    setLastEvent('');
    setBusy(false);
  };

  const sendEvent = async (payload: any) => {
    if (!session) return;
    setBusy(true);
    try {
      const data = await postJson<any>(`/api/session/${session.id}/event`, payload);
      if (data.tzafon?.length) setTzafon((lines) => [...lines, ...data.tzafon]);
      if (data.image) setImage(data.image);
      if (data.meta) setLastEvent(data.meta);
      else if (payload.type === 'scroll' && data.scroll) {
        setLastEvent(`scroll y: ${data.scroll.start.y} → ${data.scroll.end.y}`);
      } else {
        setLastEvent('');
      }
      setInfo(data.info || 'Captured');
      setTimeout(() => overlayRef.current?.focus(), 20);
    } catch (err: any) {
      setInfo(err?.message || 'Event failed');
      toast({ status: 'error', title: 'Event failed', description: err?.message || 'Unknown error' });
    } finally {
      setBusy(false);
    }
  };

  const handleClick = (evt: React.MouseEvent<HTMLDivElement>) => {
    if (!session || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = (imgRef.current.naturalWidth || rect.width) / rect.width;
    const scaleY = (imgRef.current.naturalHeight || rect.height) / rect.height;
    const x = Math.round((evt.clientX - rect.left) * scaleX);
    const y = Math.round((evt.clientY - rect.top) * scaleY);
    sendEvent({ type: 'click', x, y });
  };

  const handleWheel = (evt: React.WheelEvent<HTMLDivElement>) => {
    if (!session) return;
    evt.preventDefault();
    sendEvent({ type: 'scroll', deltaX: Math.round(evt.deltaX), deltaY: Math.round(evt.deltaY) });
  };

  const handleKey = (evt: React.KeyboardEvent<HTMLDivElement>) => {
    if (!session) return;
    if (evt.key === 'Enter') {
      evt.preventDefault();
      sendEvent({ type: 'key', key: 'Enter' });
    }
  };

  const handleType = () => {
    if (!session || !text.trim()) return;
    sendEvent({ type: 'type', text: text.trim() });
    setText('');
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(tzafon.join('\n'));
      toast({ status: 'success', title: 'Copied tzafon code' });
    } catch {
      toast({ status: 'warning', title: 'Clipboard blocked', description: 'Copy manually from the textarea' });
    }
  };

  return (
    <Box px={6} py={6}>
      <Flex justify="space-between" align={{ base: 'flex-start', md: 'flex-end' }} gap={4} wrap="wrap">
        <Box>
          <Heading size="lg">Playwright Browser in React</Heading>
          <Text color="gray.400" mt={1}>
            Single-page app with Chakra UI. Interact on the preview to generate tzafon steps.
          </Text>
        </Box>
        <HStack spacing={3}>
          <Button leftIcon={<Icon as={FiCopy} />} onClick={copyCode} isDisabled={!tzafon.length}>
            Copy tzafon code
          </Button>
          <Tag colorScheme={session ? 'green' : 'gray'}>
            {session ? `Session ${session.id.slice(0, 8)}…` : 'No session'}
          </Tag>
        </HStack>
      </Flex>

      <Box as="form" onSubmit={startSession} mt={6}>
        <HStack align="center" spacing={3} flexWrap="wrap">
          <HStack>
            <Icon as={FiLink} color="gray.400" />
            <Text color="gray.400" fontSize="sm">
              Target URL
            </Text>
          </HStack>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            type="url"
            minW="320px"
            bg="#0f172a"
            borderColor="#1f2937"
            color="white"
          />
          <Button
            type="submit"
            leftIcon={<Icon as={FiPlay} />}
            isLoading={busy}
            colorScheme="teal"
          >
            {session ? 'Restart' : 'Start'}
          </Button>
          <Button
            type="button"
            leftIcon={<Icon as={FiStopCircle} />}
            onClick={closeSession}
            isDisabled={!session || busy}
            variant="outline"
            borderColor="#243248"
          >
            Close
          </Button>
        </HStack>
      </Box>

      <Grid templateColumns={{ base: '1fr', md: '2fr 1fr' }} gap={5} mt={6}>
        <Stack bg="#111827" border="1px solid #1f2937" borderRadius="16px" p={4} spacing={4} boxShadow="lg">
          <Box position="relative" borderRadius="12px" overflow="hidden" border="1px solid #1f2937" bg="#131c2e" minH="320px">
            {image ? (
              <img ref={imgRef} src={image} alt="preview" style={{ display: 'block', width: '100%' }} />
            ) : (
              <Box p={6} color="gray.500">
                {session ? 'Waiting for screenshot...' : 'Start a session to see the page'}
              </Box>
            )}
            <Box
              ref={overlayRef}
              tabIndex={0}
              position="absolute"
              inset={0}
              outline="none"
              onClick={handleClick}
              onWheel={handleWheel}
              onKeyDown={handleKey}
            />
          </Box>

          <HStack spacing={3} align="center">
            <Text color="gray.400" fontSize="sm">
              Type text
            </Text>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="query or input text"
              bg="#0f172a"
              borderColor="#1f2937"
              color="white"
              minW="200px"
            />
            <Button onClick={handleType} isDisabled={!session || busy}>
              Type
            </Button>
            <Button
              onClick={() => sendEvent({ type: 'key', key: 'Enter' })}
              isDisabled={!session || busy}
              colorScheme="blue"
              variant="solid"
            >
              Press Enter
            </Button>
          </HStack>

          <Box color="gray.400" fontSize="sm">
            <Text>{info}</Text>
            {lastEvent ? <Text mt={1}>Last event: {lastEvent}</Text> : null}
          </Box>
        </Stack>

        <Stack bg="#111827" border="1px solid #1f2937" borderRadius="16px" p={4} spacing={3} boxShadow="lg">
          <HStack justify="space-between">
            <Text color="gray.400">Generated tzafon steps</Text>
            {session ? <Tag colorScheme="purple">Live</Tag> : <Tag>Idle</Tag>}
          </HStack>
          <Textarea
            value={tzafon.join('\n')}
            readOnly
            minH="420px"
            bg="#0b1220"
            borderColor="#1f2937"
            color="gray.100"
            fontFamily="'JetBrains Mono', monospace"
          />
        </Stack>
      </Grid>
    </Box>
  );
}
