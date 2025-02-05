import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { MessageList, SystemMessage } from 'react-chat-elements';

import { getIcon, useInjectable } from '@opensumi/ide-core-browser';
import { Popover, PopoverPosition } from '@opensumi/ide-core-browser/lib/components';
import { EnhanceIcon } from '@opensumi/ide-core-browser/lib/components/ai-native';
import {
  AISerivceType,
  ChatFeatureRegistryToken,
  ChatRenderRegistryToken,
  ChatServiceToken,
  Disposable,
  IAIReporter,
  localize,
  uuid,
} from '@opensumi/ide-core-common';
import { MonacoCommandRegistry } from '@opensumi/ide-editor/lib/browser/monaco-contrib/command/command.service';
import { IMainLayoutService } from '@opensumi/ide-main-layout';

import 'react-chat-elements/dist/main.css';
import { AI_CHAT_VIEW_ID, IChatAgentService, IChatInternalService, IChatMessageStructure } from '../../common';
import { CodeBlockWrapperInput } from '../components/ChatEditor';
import { ChatInput } from '../components/ChatInput';
import { ChatMarkdown } from '../components/ChatMarkdown';
import { ChatNotify, ChatReply } from '../components/ChatReply';
import { ChatThinking } from '../components/ChatThinking';
import { SlashCustomRender } from '../components/SlashCustomRender';
import { StreamReplyRender } from '../components/StreamReplyRender';
import { MessageData, createMessageByAI, createMessageByUser } from '../components/utils';
import { WelcomeMessage } from '../components/WelcomeMsg';
import { MsgHistoryManager } from '../model/msg-history-manager';
import { EMsgStreamStatus, MsgStreamManager } from '../model/msg-stream-manager';
import { IChatSlashCommandHandler, TSlashCommandCustomRender } from '../types';

import { ChatService } from './chat.api.service';
import { ChatFeatureRegistry } from './chat.feature.registry';
import { ChatInternalService } from './chat.internal.service';
import styles from './chat.module.less';
import { ChatRenderRegistry } from './chat.render.registry';

const SCROLL_CLASSNAME = 'chat_scroll';

export const AIChatView = observer(() => {
  const aiChatService = useInjectable<ChatInternalService>(IChatInternalService);
  const chatApiService = useInjectable<ChatService>(ChatServiceToken);
  const aiReporter = useInjectable<IAIReporter>(IAIReporter);
  const msgStreamManager = useInjectable<MsgStreamManager>(MsgStreamManager);
  const chatAgentService = useInjectable<IChatAgentService>(IChatAgentService);
  const chatFeatureRegistry = useInjectable<ChatFeatureRegistry>(ChatFeatureRegistryToken);
  const chatRenderRegistry = useInjectable<ChatRenderRegistry>(ChatRenderRegistryToken);
  const monacoCommandRegistry = useInjectable<MonacoCommandRegistry>(MonacoCommandRegistry);
  const layoutService = useInjectable<IMainLayoutService>(IMainLayoutService);
  const msgHistoryManager = useInjectable<MsgHistoryManager>(MsgHistoryManager);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chatInputRef = React.useRef<{ setInputValue: (v: string) => void } | null>(null);

  const [messageListData, dispatchMessage] = React.useReducer(
    (state: MessageData[], action: { type: 'add' | 'clear' | 'init'; payload?: MessageData[] }) => {
      switch (action.type) {
        case 'add':
          return [...state, ...(action.payload || [])];
        case 'clear':
          return [];
        case 'init':
          return Array.isArray(action.payload) ? action.payload : [];
        default:
          return state;
      }
    },
    [],
  );

  const [loading, setLoading] = React.useState(false);
  const [loading2, setLoading2] = React.useState(false);

  const [agentId, setAgentId] = React.useState('');
  const [defaultAgentId, setDefaultAgentId] = React.useState<string>('');
  const [command, setCommand] = React.useState('');
  const [theme, setTheme] = React.useState<string | null>(null);

  const aiAssistantName = React.useMemo(() => localize('aiNative.chat.ai.assistant.name'), []);

  const shortcutCommands = React.useMemo(() => chatFeatureRegistry.getAllShortcutSlashCommand(), [chatFeatureRegistry]);

  const ChatInputWrapperRender = React.useMemo(() => {
    if (chatRenderRegistry.chatInputRender) {
      return chatRenderRegistry.chatInputRender;
    }
    return ChatInput;
  }, [chatRenderRegistry.chatInputRender]);

  React.useEffect(() => {
    msgStreamManager.onMsgStatus((event) => {
      if (event === EMsgStreamStatus.DONE || event === EMsgStreamStatus.ERROR) {
        setLoading2(false);
      } else if (event === EMsgStreamStatus.THINKING) {
        setLoading2(true);
      }

      requestAnimationFrame(() => {
        scrollToBottom();
      });
    });
    return () => {
      msgStreamManager.dispose();
    };
  }, []);

  const firstMsg = React.useMemo(
    () =>
      createMessageByAI({
        id: uuid(6),
        relationId: '',
        text: <WelcomeMessage />,
      }),
    [],
  );

  const scrollToBottom = React.useCallback(() => {
    if (containerRef && containerRef.current) {
      containerRef.current.scrollTop = Number.MAX_SAFE_INTEGER;
      // 出现滚动条时出现分割线
      if (containerRef.current.scrollHeight > containerRef.current.clientHeight) {
        containerRef.current.classList.add(SCROLL_CLASSNAME);
      }
    }
  }, [containerRef]);

  React.useEffect(() => {
    dispatchMessage({ type: 'init', payload: [firstMsg] });
  }, []);

  React.useEffect(() => {
    scrollToBottom();
  }, [loading, loading2]);

  React.useEffect(() => {
    const disposer = new Disposable();

    disposer.addDispose(
      chatApiService.onChatMessageLaunch(async (message) => {
        if (message.immediate !== false) {
          if (loading || loading2) {
            return;
          }
          await handleSend(message);
        } else {
          if (message.agentId) {
            setAgentId(message.agentId);
          }
          if (message.command) {
            setCommand(message.command);
          }
          chatInputRef?.current?.setInputValue(message.message);
        }
      }),
    );

    disposer.addDispose(
      chatApiService.onChatReplyMessageLaunch((chunk) => {
        const relationId = aiReporter.start(AISerivceType.CustomReplay, {
          msgType: AISerivceType.CustomReplay,
          message: chunk,
        });

        let renderContent = <ChatMarkdown markdown={chunk} fillInIncompleteTokens />;

        if (chatRenderRegistry.chatAIRoleRender) {
          const ChatAIRoleRender = chatRenderRegistry.chatAIRoleRender;
          renderContent = <ChatAIRoleRender content={chunk} status={EMsgStreamStatus.DONE} />;
        }

        msgHistoryManager.addAssistantMessage({
          content: chunk,
        });

        const aiMessage = createMessageByAI({
          id: uuid(6),
          relationId,
          text: renderContent,
          className: styles.chat_with_more_actions,
        });

        dispatchMessage({ type: 'add', payload: [aiMessage] });
      }),
    );

    return () => disposer.dispose();
  }, [chatApiService, chatRenderRegistry.chatAIRoleRender, msgHistoryManager]);

  React.useEffect(() => {
    const disposer = new Disposable();

    disposer.addDispose(
      chatAgentService.onDidSendMessage((chunk) => {
        const relationId = aiReporter.start(AISerivceType.Agent, {
          msgType: AISerivceType.Agent,
          message: '',
        });

        msgHistoryManager.addAssistantMessage({
          content: chunk.content,
        });

        const notifyMessage = createMessageByAI(
          {
            id: uuid(6),
            relationId,
            text: <ChatNotify relationId={relationId} chunk={chunk} />,
          },
          styles.chat_notify,
        );

        dispatchMessage({ type: 'add', payload: [notifyMessage] });
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      }),
    );

    disposer.addDispose(
      chatAgentService.onDidChangeAgents(async () => {
        const newDefaultAgentId = chatAgentService.getDefaultAgentId();
        setDefaultAgentId(newDefaultAgentId ?? '');
      }),
    );

    return () => disposer.dispose();
  }, [chatAgentService, msgHistoryManager]);

  const handleSlashCustomRender = React.useCallback(
    async (value: {
      userMessage: string;
      render: TSlashCommandCustomRender;
      relationId: string;
      startTime: number;
    }) => {
      const { userMessage, relationId, render, startTime } = value;

      msgHistoryManager.addAssistantMessage({
        type: 'component',
        content: '',
      });

      const aiMessage = createMessageByAI({
        id: uuid(6),
        relationId,
        className: styles.chat_with_more_actions,
        text: (
          <SlashCustomRender
            userMessage={userMessage}
            startTime={startTime}
            relationId={relationId}
            renderContent={render}
          />
        ),
      });

      dispatchMessage({ type: 'add', payload: [aiMessage] });

      if (containerRef && containerRef.current) {
        containerRef.current.scrollTop = Number.MAX_SAFE_INTEGER;
      }
    },
    [containerRef, msgHistoryManager],
  );

  const handleAgentReply = React.useCallback(
    async (value: IChatMessageStructure) => {
      const { message, agentId, command } = value;
      const ChatUserRoleRender = chatRenderRegistry.chatUserRoleRender;

      const request = aiChatService.createRequest(message, agentId!, command);
      if (!request) {
        return;
      }

      const startTime = Date.now();
      const relationId = aiReporter.start(AISerivceType.Agent, {
        msgType: AISerivceType.Agent,
        message: value.message,
      });

      msgHistoryManager.addAgentMessage({
        content: message,
        agentId: agentId!,
        agentCommand: command!,
      });

      const userMessage = createMessageByUser(
        {
          id: uuid(6),
          relationId,
          text: ChatUserRoleRender ? (
            <ChatUserRoleRender content={message} agentId={agentId} command={command} />
          ) : (
            <CodeBlockWrapperInput relationId={relationId} text={message} agentId={agentId} command={command} />
          ),
        },
        styles.chat_message_code,
      );

      const aiMsgId = msgHistoryManager.addAssistantMessage({
        content: '',
        relationId,
      });

      const aiMessage = createMessageByAI({
        id: uuid(6),
        relationId,
        className: styles.chat_with_more_actions,
        text: (
          <ChatReply
            relationId={relationId}
            request={request}
            startTime={startTime}
            onDidChange={(content) => {
              msgHistoryManager.updateAssistantMessage(aiMsgId, { content });
            }}
            onRegenerate={() => {
              msgStreamManager.sendThinkingStatue();
              aiChatService.sendRequest(request, true);
            }}
          />
        ),
      });

      msgStreamManager.setCurrentSessionId(relationId);
      msgStreamManager.sendThinkingStatue();
      aiChatService.setLatestSessionId(relationId);
      aiChatService.sendRequest(request);

      dispatchMessage({ type: 'add', payload: [userMessage, aiMessage] });

      if (containerRef && containerRef.current) {
        containerRef.current.scrollTop = Number.MAX_SAFE_INTEGER;
      }
    },
    [chatRenderRegistry, chatRenderRegistry.chatUserRoleRender, msgHistoryManager],
  );

  const handleSend = React.useCallback(
    async (value: IChatMessageStructure) => {
      const { message, prompt, reportType, agentId, command } = value;
      const ChatUserRoleRender = chatRenderRegistry.chatUserRoleRender;

      if (agentId) {
        return handleAgentReply({ message, agentId, command });
      }

      const userInput = {
        type: AISerivceType.Chat,
        message: prompt || message,
      };

      const { nameWithSlash } = chatFeatureRegistry.parseSlashCommand(message);
      let commandHandler: IChatSlashCommandHandler | undefined;

      if (nameWithSlash) {
        commandHandler = chatFeatureRegistry.getSlashCommandHandlerBySlashName(nameWithSlash);
      }

      if (commandHandler && commandHandler.providerPrompt) {
        const editor = monacoCommandRegistry.getActiveCodeEditor();
        const slashCommandPrompt = await commandHandler.providerPrompt(message, editor);
        userInput.message = slashCommandPrompt;
      }

      const startTime = Date.now();
      const relationId = aiReporter.start(reportType || userInput.type, {
        msgType: reportType || userInput.type,
        message: userInput.message,
      });

      msgHistoryManager.addUserMessage({
        content: message,
      });

      const sendMessage = createMessageByUser(
        {
          id: uuid(6),
          relationId,
          text: ChatUserRoleRender ? (
            <ChatUserRoleRender content={message} agentId={agentId} command={command} />
          ) : (
            <CodeBlockWrapperInput relationId={relationId} text={message} agentId={agentId} command={command} />
          ),
        },
        styles.chat_message_code,
      );

      dispatchMessage({ type: 'add', payload: [sendMessage] });

      if (commandHandler && commandHandler.providerRender) {
        return handleSlashCustomRender({
          userMessage: message,
          render: commandHandler.providerRender,
          relationId,
          startTime,
        });
      }

      setLoading(true);

      handleReply(userInput, relationId);
    },
    [
      messageListData,
      containerRef,
      loading,
      chatFeatureRegistry,
      chatRenderRegistry,
      chatRenderRegistry.chatUserRoleRender,
      msgHistoryManager,
    ],
  );

  const handleReply = React.useCallback(
    (userInput: { type: AISerivceType; message: string }, relationId: string) => {
      aiChatService.setLatestSessionId(relationId);
      aiChatService.messageWithStream(userInput.message, {}, relationId);

      const msgId = msgHistoryManager.addAssistantMessage({
        content: '',
        relationId,
      });

      const aiMessage = createMessageByAI({
        id: uuid(6),
        relationId,
        text: (
          <StreamReplyRender
            prompt={userInput.message}
            relationId={relationId}
            onDidChange={(content) => {
              msgHistoryManager.updateAssistantMessage(msgId, { content });
            }}
          />
        ),
        className: styles.chat_with_more_actions,
      });

      if (aiMessage) {
        dispatchMessage({ type: 'add', payload: [aiMessage] });
        if (containerRef && containerRef.current) {
          containerRef.current.scrollTop = Number.MAX_SAFE_INTEGER;
        }
      }

      setLoading(false);
    },
    [messageListData, aiChatService, msgHistoryManager],
  );

  const handleClear = React.useCallback(() => {
    aiChatService.cancelChatViewToken();
    aiChatService.destroyStreamRequest(msgStreamManager.currentSessionId);
    aiChatService.clearSessionModel();
    containerRef?.current?.classList.remove(SCROLL_CLASSNAME);
    dispatchMessage({ type: 'init', payload: [firstMsg] });
  }, [messageListData]);

  const handleThemeClick = (value) => {
    if (loading || loading2) {
      return;
    }
    setTheme(value);
  };

  const handleCloseChatView = React.useCallback(() => {
    layoutService.toggleSlot(AI_CHAT_VIEW_ID);
  }, [layoutService]);

  return (
    <div id={styles.ai_chat_view}>
      <div className={styles.header_container}>
        <div className={styles.left}>
          <span className={styles.title}>{aiAssistantName}</span>
        </div>
        <div className={styles.right}>
          <Popover
            overlayClassName={styles.popover_icon}
            id={'ai-chat-header-clear'}
            title={localize('aiNative.operate.clear.title')}
          >
            <EnhanceIcon wrapperClassName={styles.action_btn} className={getIcon('clear')} onClick={handleClear} />
          </Popover>
          <Popover
            overlayClassName={styles.popover_icon}
            id={'ai-chat-header-close'}
            position={PopoverPosition.left}
            title={localize('aiNative.operate.close.title')}
          >
            <EnhanceIcon
              wrapperClassName={styles.action_btn}
              className={getIcon('window-close')}
              onClick={handleCloseChatView}
            />
          </Popover>
        </div>
      </div>
      <div className={styles.body_container}>
        <div className={styles.left_bar} id='ai_chat_left_container'>
          <div className={styles.chat_container} ref={containerRef}>
            <MessageList
              className={styles.message_list}
              lockable={true}
              toBottomHeight={'100%'}
              // @ts-ignore
              dataSource={messageListData}
            />
            {loading && (
              <div className={styles.chat_loading_msg_box}>
                <SystemMessage
                  title={aiAssistantName}
                  className={styles.smsg}
                  // @ts-ignore
                  text={<ChatThinking status={EMsgStreamStatus.THINKING} />}
                />
              </div>
            )}
          </div>
          <div className={styles.chat_input_wrap}>
            <div className={styles.header_operate}>
              <div className={styles.header_operate_left}>
                {shortcutCommands.map((command) => (
                  <Popover
                    id={`ai-chat-shortcut-${command.name}`}
                    key={`ai-chat-shortcut-${command.name}`}
                    title={command.tooltip || command.name}
                  >
                    <div className={styles.tag} onClick={() => handleThemeClick(command.nameWithSlash)}>
                      {command.name}
                    </div>
                  </Popover>
                ))}
              </div>
              <div className={styles.header_operate_right}></div>
            </div>
            <ChatInputWrapperRender
              onSend={(value, agentId, command) => handleSend({ message: value, agentId, command })}
              disabled={loading || loading2}
              enableOptions={true}
              theme={theme}
              setTheme={setTheme}
              agentId={agentId}
              setAgentId={setAgentId}
              defaultAgentId={defaultAgentId}
              command={command}
              setCommand={setCommand}
              ref={chatInputRef}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
